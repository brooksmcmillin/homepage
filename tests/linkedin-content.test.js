import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadScript } from "./load.js";

// linkedin/selectors.js declares globals (LINKEDIN_SELECTORS,
// LINKEDIN_URN_ATTRS) via top-level `const`. Re-load the file in our own
// scope so we can hand the values to the content-script factory below.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const selectorsCode = readFileSync(
  resolve(ROOT, "linkedin/selectors.js"),
  "utf8",
);
const { LINKEDIN_SELECTORS, LINKEDIN_URN_ATTRS } = new Function(
  `${selectorsCode}\nreturn { LINKEDIN_SELECTORS, LINKEDIN_URN_ATTRS };`,
)();

const createContent = loadScript("linkedin/content.js", {
  globals: [
    "LINKEDIN_SELECTORS",
    "LINKEDIN_URN_ATTRS",
    "browser",
    "fetch",
    "MutationObserver",
    "console",
  ],
  returnExpr: `{
    FLUSH_DEBOUNCE_MS,
    SEEN_IDS_MAX,
    extractThreadIdFromHref,
    extractThreadFromListItem,
    extractMessageFromBubble,
    queueThread,
    queueMessage,
    flushBatch,
    scheduleFlush,
    scanThreadList,
    scanActiveConversation,
    loadSeenIds,
    persistSeenIds,
    get seenPlatformIds() { return seenPlatformIds; },
    set seenPlatformIds(v) { seenPlatformIds = v; },
    get pendingThreads() { return pendingThreads; },
    set pendingThreads(v) { pendingThreads = v; },
    get pendingMessages() { return pendingMessages; },
    set pendingMessages(v) { pendingMessages = v; },
  }`,
  stripAfterLast: "init();",
});

function makeBrowser({ apiToken = null, sessionStore = {} } = {}) {
  const store = { ...sessionStore };
  return {
    _sessionStore: store,
    storage: {
      session: {
        get: vi.fn((key) => {
          if (typeof key === "string") {
            return Promise.resolve(key in store ? { [key]: store[key] } : {});
          }
          return Promise.resolve({ ...store });
        }),
        set: vi.fn((kv) => {
          Object.assign(store, kv);
          return Promise.resolve();
        }),
      },
      local: {
        get: vi.fn((key) => {
          if (key === "apiToken") {
            return Promise.resolve(apiToken !== null ? { apiToken } : {});
          }
          return Promise.resolve({});
        }),
      },
    },
  };
}

class MockObserver {
  observe() {}
  disconnect() {}
}

const noopConsole = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeContent({ apiToken = null, fetch = vi.fn() } = {}) {
  return createContent(
    LINKEDIN_SELECTORS,
    LINKEDIN_URN_ATTRS,
    makeBrowser({ apiToken }),
    fetch,
    MockObserver,
    noopConsole,
  );
}

describe("linkedin/content.js — extractThreadIdFromHref", () => {
  let content;
  beforeEach(() => {
    content = makeContent();
  });

  it("parses thread id from canonical URL", () => {
    expect(
      content.extractThreadIdFromHref(
        "/messaging/thread/2-abc-123==/?context=foo",
      ),
    ).toBe("2-abc-123==");
  });

  it("parses thread id from absolute URL", () => {
    expect(
      content.extractThreadIdFromHref(
        "https://www.linkedin.com/messaging/thread/urn-li-msg-thread-99/",
      ),
    ).toBe("urn-li-msg-thread-99");
  });

  it("returns null for unrelated paths", () => {
    expect(content.extractThreadIdFromHref("/feed/")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(content.extractThreadIdFromHref(null)).toBeNull();
    expect(content.extractThreadIdFromHref("")).toBeNull();
  });
});

describe("linkedin/content.js — extractThreadFromListItem", () => {
  let content;
  beforeEach(() => {
    document.body.innerHTML = "";
    content = makeContent();
  });

  it("extracts id, name, avatar from a typical thread item", () => {
    document.body.innerHTML = `
      <li class="msg-conversation-listitem"
          data-conversation-urn="urn:li:msg:thread:42">
        <a href="/messaging/thread/2-foo==/?ref=x"></a>
        <div class="msg-conversation-listitem__participant-names">Alice Doe</div>
        <img src="https://example.com/alice.jpg" />
        <time datetime="2026-04-29T15:00:00+00:00">3:00 PM</time>
      </li>
    `;
    const el = document.querySelector(".msg-conversation-listitem");
    const result = content.extractThreadFromListItem(el);
    expect(result.platform_thread_id).toBe("urn:li:msg:thread:42");
    expect(result.last_message_at).toBe("2026-04-29T15:00:00+00:00");
    expect(result.participants).toEqual([
      {
        name: "Alice Doe",
        profile_url: null,
        avatar_url: "https://example.com/alice.jpg",
      },
    ]);
  });

  it("falls back to URL when data-conversation-urn is absent", () => {
    document.body.innerHTML = `
      <li class="msg-conversation-listitem">
        <a href="/messaging/thread/from-href-id/"></a>
      </li>
    `;
    const el = document.querySelector(".msg-conversation-listitem");
    const result = content.extractThreadFromListItem(el);
    expect(result.platform_thread_id).toBe("from-href-id");
  });

  it("returns null when no platform id can be determined", () => {
    document.body.innerHTML = `<li class="msg-conversation-listitem"></li>`;
    const el = document.querySelector(".msg-conversation-listitem");
    expect(content.extractThreadFromListItem(el)).toBeNull();
  });

  it("flags unread threads via the unread class", () => {
    document.body.innerHTML = `
      <li class="msg-conversation-listitem msg-conversation-listitem--unread"
          data-conversation-urn="urn:li:msg:thread:1">
      </li>
    `;
    const el = document.querySelector(".msg-conversation-listitem");
    const result = content.extractThreadFromListItem(el);
    expect(result._is_unread).toBe(true);
  });
});

describe("linkedin/content.js — extractMessageFromBubble", () => {
  let content;
  beforeEach(() => {
    document.body.innerHTML = "";
    content = makeContent();
  });

  function setupGroup({
    direction = "inbound",
    eventUrn = "urn:li:fs_event:1",
    body = "hello there",
    senderName = "Alice",
    senderHref = "https://www.linkedin.com/in/alice/",
    datetime = "2026-04-29T15:00:00+00:00",
  } = {}) {
    const groupClass =
      direction === "inbound"
        ? "msg-s-message-group msg-s-message-group--other"
        : "msg-s-message-group";
    const bubbleClass =
      direction === "inbound"
        ? "msg-s-event-listitem msg-s-event-listitem--other"
        : "msg-s-event-listitem";
    document.body.innerHTML = `
      <ul class="msg-s-message-list">
        <div class="${groupClass}">
          <a class="msg-s-message-group__profile-link" href="${senderHref}">
            <span class="msg-s-message-group__name">${senderName}</span>
          </a>
          <time class="msg-s-message-group__timestamp" datetime="${datetime}">3:00 PM</time>
          <li class="${bubbleClass}" data-event-urn="${eventUrn}">
            <p class="msg-s-event-listitem__body">${body}</p>
          </li>
        </div>
      </ul>
    `;
    return document.querySelector(".msg-s-event-listitem");
  }

  it("extracts inbound message with sender + body + timestamp", () => {
    const el = setupGroup({ direction: "inbound" });
    const msg = content.extractMessageFromBubble(el, "thread-1");
    expect(msg).toEqual({
      platform_message_id: "urn:li:fs_event:1",
      thread_platform_id: "thread-1",
      direction: "inbound",
      sender_name: "Alice",
      sender_profile_url: "https://www.linkedin.com/in/alice/",
      sender_avatar_url: null,
      body: "hello there",
      sent_at: "2026-04-29T15:00:00+00:00",
      is_read: false,
    });
  });

  it("infers outbound when bubble lacks --other and no sender name", () => {
    document.body.innerHTML = `
      <div class="msg-s-message-group">
        <time class="msg-s-message-group__timestamp" datetime="2026-04-29T16:00:00+00:00">4:00 PM</time>
        <li class="msg-s-event-listitem" data-event-urn="urn:li:fs_event:9">
          <p class="msg-s-event-listitem__body">my reply</p>
        </li>
      </div>
    `;
    const el = document.querySelector(".msg-s-event-listitem");
    const msg = content.extractMessageFromBubble(el, "thread-1");
    expect(msg.direction).toBe("outbound");
    expect(msg.is_read).toBe(true);
  });

  it("returns null when no platform_message_id is recoverable", () => {
    document.body.innerHTML = `
      <li class="msg-s-event-listitem">
        <p class="msg-s-event-listitem__body">hi</p>
      </li>
    `;
    const el = document.querySelector(".msg-s-event-listitem");
    expect(content.extractMessageFromBubble(el, "thread-1")).toBeNull();
  });

  it("returns null when no datetime can be found", () => {
    document.body.innerHTML = `
      <li class="msg-s-event-listitem" data-event-urn="urn:li:fs_event:1">
        <p class="msg-s-event-listitem__body">hi</p>
      </li>
    `;
    const el = document.querySelector(".msg-s-event-listitem");
    expect(content.extractMessageFromBubble(el, "thread-1")).toBeNull();
  });

  it("returns null when threadPlatformId is missing", () => {
    const el = setupGroup();
    expect(content.extractMessageFromBubble(el, null)).toBeNull();
  });
});

describe("linkedin/content.js — queueing + seen filter", () => {
  let content;
  beforeEach(() => {
    content = makeContent();
  });

  it("queueMessage skips ids already in the seen set", () => {
    content.seenPlatformIds = new Set(["dup-1"]);
    content.queueMessage({
      platform_message_id: "dup-1",
      thread_platform_id: "t",
      direction: "inbound",
      sender_name: "A",
      sender_profile_url: null,
      sender_avatar_url: null,
      body: "x",
      sent_at: "2026-04-29T15:00:00+00:00",
      is_read: false,
    });
    expect(content.pendingMessages.size).toBe(0);
  });

  it("queueThread overwrites earlier payloads for same id", () => {
    content.queueThread({ platform_thread_id: "t1", participants: [] });
    content.queueThread({
      platform_thread_id: "t1",
      participants: [{ name: "Updated", profile_url: null, avatar_url: null }],
    });
    expect(content.pendingThreads.size).toBe(1);
    expect(content.pendingThreads.get("t1").participants[0].name).toBe(
      "Updated",
    );
  });
});

describe("linkedin/content.js — flushBatch", () => {
  let content;
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it("skips POST and does not mark seen when no token is set", async () => {
    content = makeContent({ apiToken: null, fetch: mockFetch });
    content.queueThread({
      platform_thread_id: "t1",
      participants: [],
      last_message_at: null,
    });
    content.queueMessage({
      platform_message_id: "m1",
      thread_platform_id: "t1",
      direction: "inbound",
      sender_name: "A",
      sender_profile_url: null,
      sender_avatar_url: null,
      body: "hi",
      sent_at: "2026-04-29T15:00:00+00:00",
      is_read: false,
    });

    await content.flushBatch();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(content.seenPlatformIds.has("m1")).toBe(false);
    // Pending maps cleared so we don't leak the batch indefinitely.
    expect(content.pendingThreads.size).toBe(0);
    expect(content.pendingMessages.size).toBe(0);
  });

  it("POSTs with Bearer token when one is set, then marks ids seen", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    content = makeContent({ apiToken: "tm_test_xyz", fetch: mockFetch });

    content.queueThread({
      platform_thread_id: "t1",
      participants: [],
      last_message_at: null,
    });
    content.queueMessage({
      platform_message_id: "m1",
      thread_platform_id: "t1",
      direction: "inbound",
      sender_name: "A",
      sender_profile_url: null,
      sender_avatar_url: null,
      body: "hi",
      sent_at: "2026-04-29T15:00:00+00:00",
      is_read: false,
    });

    await content.flushBatch();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://api.nexus.brooksmcmillin.com/api/linkedin/messages/ingest",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tm_test_xyz");
    const payload = JSON.parse(init.body);
    expect(payload.threads).toHaveLength(1);
    expect(payload.messages).toHaveLength(1);
    expect(content.seenPlatformIds.has("m1")).toBe(true);
  });

  it("drops the batch on network failure (no infinite buildup)", async () => {
    mockFetch.mockRejectedValue(new Error("boom"));
    content = makeContent({ apiToken: "tm_test_xyz", fetch: mockFetch });

    content.queueMessage({
      platform_message_id: "m1",
      thread_platform_id: "t1",
      direction: "inbound",
      sender_name: "A",
      sender_profile_url: null,
      sender_avatar_url: null,
      body: "hi",
      sent_at: "2026-04-29T15:00:00+00:00",
      is_read: false,
    });

    await content.flushBatch();

    expect(content.pendingMessages.size).toBe(0);
    expect(content.seenPlatformIds.has("m1")).toBe(false);
  });

  it("returns early without POSTing when nothing is pending", async () => {
    content = makeContent({ apiToken: "tm_test_xyz", fetch: mockFetch });
    await content.flushBatch();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("linkedin/content.js — persistSeenIds cap", () => {
  let content;
  beforeEach(() => {
    content = makeContent();
  });

  it("truncates seenPlatformIds beyond SEEN_IDS_MAX", async () => {
    const cap = content.SEEN_IDS_MAX;
    const ids = [];
    for (let i = 0; i < cap + 50; i++) ids.push(`id-${i}`);
    content.seenPlatformIds = new Set(ids);

    await content.persistSeenIds();

    expect(content.seenPlatformIds.size).toBe(cap);
    // Oldest entries fall off; newest survive.
    expect(content.seenPlatformIds.has(`id-${cap + 49}`)).toBe(true);
    expect(content.seenPlatformIds.has("id-0")).toBe(false);
  });
});

describe("linkedin/content.js — scheduleFlush debouncing", () => {
  let content;
  let mockFetch;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    content = makeContent({ apiToken: "tm_test_xyz", fetch: mockFetch });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("collapses repeated scheduleFlush calls into one POST", async () => {
    content.queueMessage({
      platform_message_id: "m1",
      thread_platform_id: "t1",
      direction: "inbound",
      sender_name: "A",
      sender_profile_url: null,
      sender_avatar_url: null,
      body: "hi",
      sent_at: "2026-04-29T15:00:00+00:00",
      is_read: false,
    });

    content.scheduleFlush();
    content.scheduleFlush();
    content.scheduleFlush();

    await vi.advanceTimersByTimeAsync(content.FLUSH_DEBOUNCE_MS + 10);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
