// Content script entry for LinkedIn messaging.
// Loaded on https://www.linkedin.com/messaging/* via manifest content_scripts;
// linkedin/selectors.js is loaded first and exposes LINKEDIN_SELECTORS +
// LINKEDIN_URN_ATTRS.
//
// Responsibilities (task #1305):
//   1. Initial scan of the visible thread list + active conversation on load.
//   2. MutationObserver on the messaging containers to catch new threads,
//      new messages, and thread switches.
//   3. Debounced batch POST to /api/linkedin/messages/ingest on changes.
//   4. Local seen-id cache in browser.storage.session so we don't re-upload
//      the same message bubble on every observer tick.
//
// Auth: ingest requires an API key with `linkedin:ingest` scope. Until task
// #1306 ships the settings UI, the content script reads `apiToken` from
// browser.storage.local; if absent, it logs a one-time warning and skips
// the POST so the rest of the architecture still functions for testing.
//
// Firefox isolation note: content scripts see page DOM through Xray wrappers.
// Read-only DOM walks (querySelector, getAttribute, classList) work natively;
// only React-tracked input setters (used by task #1307's send path) need
// `wrappedJSObject`.

const LINKEDIN_INGEST_URL =
  "https://api.nexus.brooksmcmillin.com/api/linkedin/messages/ingest";

// Time, in ms, to wait after the last DOM mutation before flushing a batch.
// Long enough to coalesce a burst of bubble inserts (LinkedIn often paints
// a sender header + multiple bubbles + a timestamp in quick succession),
// short enough that newly-arrived messages reach nexus quickly.
const FLUSH_DEBOUNCE_MS = 750;

// Cap on persisted seen-ids so a long-running session can't grow the
// browser.storage.session entry without bound. Oldest entries fall off
// (insertion order). Backend ingest is idempotent on platform_message_id,
// so a re-uploaded bubble is at worst a wasted round trip.
const SEEN_IDS_MAX = 10000;

const SEEN_IDS_STORAGE_KEY = "linkedin_seen_platform_ids";
const API_TOKEN_STORAGE_KEY = "apiToken";

// Module state — kept module-scope so tests can introspect via returnExpr.
let seenPlatformIds = new Set();
let pendingThreads = new Map(); // platform_thread_id -> thread payload
let pendingMessages = new Map(); // platform_message_id -> message payload
let flushTimer = null;
let warnedMissingToken = false;

// --------------------------------------------------------------------------
// seen-ids persistence
// --------------------------------------------------------------------------

async function loadSeenIds() {
  try {
    const stored = await browser.storage.session.get(SEEN_IDS_STORAGE_KEY);
    const arr = stored[SEEN_IDS_STORAGE_KEY];
    if (Array.isArray(arr)) {
      seenPlatformIds = new Set(arr);
    }
  } catch (err) {
    console.warn("[homepage:linkedin] failed to load seen ids", err);
  }
}

async function persistSeenIds() {
  let arr = Array.from(seenPlatformIds);
  if (arr.length > SEEN_IDS_MAX) {
    arr = arr.slice(-SEEN_IDS_MAX);
    seenPlatformIds = new Set(arr);
  }
  try {
    await browser.storage.session.set({ [SEEN_IDS_STORAGE_KEY]: arr });
  } catch (err) {
    console.warn("[homepage:linkedin] failed to persist seen ids", err);
  }
}

// --------------------------------------------------------------------------
// extractors
// --------------------------------------------------------------------------

function extractThreadIdFromHref(href) {
  if (!href) return null;
  const m = href.match(/\/messaging\/thread\/([^/?#]+)/);
  return m ? m[1] : null;
}

function getActiveThreadId() {
  return extractThreadIdFromHref(location.pathname + location.search);
}

function readUrnAttr(el, attrNames) {
  if (!el) return null;
  for (const name of attrNames) {
    const v = el.getAttribute(name);
    if (v) return v;
  }
  return null;
}

function safeText(el) {
  if (!el) return null;
  const t = (el.textContent || "").trim();
  return t || null;
}

function safeAttr(el, name) {
  if (!el) return null;
  return el.getAttribute(name) || null;
}

function findClosestDatetime(el) {
  // Walk up to 3 ancestors looking for a <time datetime="..."> child. The
  // datetime attribute on the message-group header carries the
  // ISO-8601 timestamp LinkedIn uses for accessibility; it's the most
  // reliable signal we have for sent_at.
  let node = el;
  for (let depth = 0; node && depth < 4; depth++) {
    const t = node.querySelector(LINKEDIN_SELECTORS.timeElement);
    if (t) {
      const dt = t.getAttribute("datetime");
      if (dt) return dt;
    }
    node = node.parentElement;
  }
  return null;
}

function extractThreadFromListItem(el) {
  if (!el) return null;
  const link = el.querySelector(LINKEDIN_SELECTORS.threadLink);
  const href = safeAttr(link, "href");
  const platformThreadId =
    readUrnAttr(el, LINKEDIN_URN_ATTRS.threadItem) ||
    extractThreadIdFromHref(href);
  if (!platformThreadId) return null;

  const nameEl = el.querySelector(LINKEDIN_SELECTORS.threadParticipantNames);
  const avatarEl = el.querySelector(LINKEDIN_SELECTORS.threadAvatarImg);
  const participants = [];
  const name = safeText(nameEl);
  const avatarUrl = safeAttr(avatarEl, "src");
  if (name || avatarUrl) {
    participants.push({
      name,
      profile_url: null,
      avatar_url: avatarUrl,
    });
  }

  const datetime = findClosestDatetime(el);

  return {
    platform_thread_id: platformThreadId,
    participants,
    last_message_at: datetime,
    _is_unread: el.classList.contains(LINKEDIN_SELECTORS.threadUnreadClass),
  };
}

function extractMessageFromBubble(el, threadPlatformId) {
  if (!el || !threadPlatformId) return null;

  const platformMessageId = readUrnAttr(el, LINKEDIN_URN_ATTRS.messageBubble);
  if (!platformMessageId) return null;

  const bodyEl = el.querySelector(LINKEDIN_SELECTORS.messageBody);
  const body = safeText(bodyEl);

  const groupEl = el.closest(LINKEDIN_SELECTORS.messageGroup);
  const senderNameEl = groupEl
    ? groupEl.querySelector(LINKEDIN_SELECTORS.senderName)
    : null;
  const senderName = safeText(senderNameEl);

  const senderLinkEl = groupEl
    ? groupEl.querySelector(LINKEDIN_SELECTORS.senderProfileLink)
    : null;
  const senderProfileUrl = safeAttr(senderLinkEl, "href");

  const senderAvatarEl = groupEl
    ? groupEl.querySelector(LINKEDIN_SELECTORS.senderAvatarImg)
    : null;
  const senderAvatarUrl = safeAttr(senderAvatarEl, "src");

  // Direction: inbound iff the bubble (or its group) carries the --other
  // modifier. Falls back to "we observed a sender name" because LinkedIn
  // never renders the user's own name on their own messages.
  const hasOther =
    el.classList.contains(LINKEDIN_SELECTORS.messageOtherClass) ||
    (groupEl &&
      groupEl.classList.contains(
        LINKEDIN_SELECTORS.messageOtherClass.replace(
          "msg-s-event-listitem",
          "msg-s-message-group",
        ),
      ));
  const direction = hasOther || senderName ? "inbound" : "outbound";

  const datetime = findClosestDatetime(el);
  if (!datetime) {
    // No machine-readable timestamp anywhere nearby — skip rather than
    // pollute the DB with synthetic times that will reorder the thread
    // detail view incorrectly.
    return null;
  }

  return {
    platform_message_id: platformMessageId,
    thread_platform_id: threadPlatformId,
    direction,
    sender_name: senderName,
    sender_profile_url: senderProfileUrl,
    sender_avatar_url: senderAvatarUrl,
    body,
    sent_at: datetime,
    // Inbound rows are not "read in nexus" until the user reviews them in
    // task-ui. Outbound rows the user authored are always read by them.
    is_read: direction === "outbound",
  };
}

// --------------------------------------------------------------------------
// scanning
// --------------------------------------------------------------------------

function scanThreadList() {
  const items = document.querySelectorAll(LINKEDIN_SELECTORS.threadItem);
  for (const item of items) {
    const thread = extractThreadFromListItem(item);
    if (!thread) continue;
    const { _is_unread, ...payload } = thread;
    void _is_unread; // currently used only by future per-message is_read inference
    queueThread(payload);
  }
}

function scanActiveConversation() {
  const threadId = getActiveThreadId();
  if (!threadId) return;
  const bubbles = document.querySelectorAll(LINKEDIN_SELECTORS.messageBubble);
  for (const bubble of bubbles) {
    const message = extractMessageFromBubble(bubble, threadId);
    if (!message) continue;
    queueMessage(message);
  }
}

function queueThread(thread) {
  pendingThreads.set(thread.platform_thread_id, thread);
}

function queueMessage(message) {
  if (seenPlatformIds.has(message.platform_message_id)) return;
  pendingMessages.set(message.platform_message_id, message);
}

// --------------------------------------------------------------------------
// flush
// --------------------------------------------------------------------------

function scheduleFlush() {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushBatch();
  }, FLUSH_DEBOUNCE_MS);
}

async function getApiToken() {
  try {
    const stored = await browser.storage.local.get(API_TOKEN_STORAGE_KEY);
    return stored[API_TOKEN_STORAGE_KEY] || null;
  } catch (err) {
    console.warn("[homepage:linkedin] failed to read api token", err);
    return null;
  }
}

async function postIngest(payload) {
  const token = await getApiToken();
  if (!token) {
    if (!warnedMissingToken) {
      warnedMissingToken = true;
      console.warn(
        "[homepage:linkedin] apiToken not set in browser.storage.local; " +
          "skipping ingest. See task #1306 for the settings UI.",
      );
    }
    return null;
  }
  const resp = await fetch(LINKEDIN_INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    throw new Error(`ingest HTTP ${resp.status}`);
  }
  return resp.json();
}

async function flushBatch() {
  if (pendingThreads.size === 0 && pendingMessages.size === 0) return;

  const threads = Array.from(pendingThreads.values());
  const messages = Array.from(pendingMessages.values()).filter(
    (m) => !seenPlatformIds.has(m.platform_message_id),
  );
  pendingThreads = new Map();
  pendingMessages = new Map();

  if (threads.length === 0 && messages.length === 0) return;

  try {
    const result = await postIngest({ threads, messages });
    // Mark messages seen even if the POST was skipped (no token); on token
    // setup the next observer tick will rescan and re-queue, so we won't
    // strand them.
    if (result !== null) {
      for (const m of messages) seenPlatformIds.add(m.platform_message_id);
      await persistSeenIds();
    }
  } catch (err) {
    console.error("[homepage:linkedin] ingest failed", err);
    // Drop the in-memory batch on failure — next mutation re-triggers a
    // scan that will re-queue any missed bubbles. Without this, a single
    // network blip would balloon the in-memory queue indefinitely.
  }
}

// --------------------------------------------------------------------------
// observer
// --------------------------------------------------------------------------

let mutationObserver = null;
let lastObservedUrl = null;

function onMutations() {
  // Re-scan everything visible. The seen-ids cache + Maps deduplicate, so
  // re-scanning is cheap; tracking individual mutations to map them back
  // to thread/message rows is much more fragile.
  if (location.href !== lastObservedUrl) {
    lastObservedUrl = location.href;
  }
  scanThreadList();
  scanActiveConversation();
  scheduleFlush();
}

function startObserver() {
  if (mutationObserver) return;
  mutationObserver = new MutationObserver(onMutations);
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
  lastObservedUrl = location.href;
}

function stopObserver() {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
}

// --------------------------------------------------------------------------
// entry point
// --------------------------------------------------------------------------

async function init() {
  console.log(
    "[homepage:linkedin] content script loaded on",
    location.pathname,
  );
  await loadSeenIds();
  // Initial scan in case messages are already painted before our observer
  // attaches (LinkedIn hydrates the convo pane fast on direct navigation).
  scanThreadList();
  scanActiveConversation();
  scheduleFlush();
  startObserver();
}

init();
