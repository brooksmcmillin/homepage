// LinkedIn messaging UI selectors. LinkedIn ships unannounced class-name
// changes; routing all DOM queries through this module keeps breakage
// localized to one file. The runtime self-test (task #1308) reports any
// selector that returns zero matches so the canary is loud.
//
// Two flavors of identifiers below:
//   * CSS selectors for `querySelector` / `querySelectorAll`
//   * Class names / attribute names for `classList.contains` / `getAttribute`
// They are kept in the same module so a future LinkedIn refactor only
// touches one file.
const LINKEDIN_SELECTORS = {
  // ---- thread list (left rail) ----
  threadList: ".msg-conversations-container__conversations-list",
  threadItem: ".msg-conversation-listitem",
  // The anchor inside a thread item whose href contains the platform thread id
  // (`/messaging/thread/<urn>/`). Used both to extract the id and to detect
  // navigation between threads.
  threadLink: "a[href*='/messaging/thread/']",
  threadParticipantNames:
    ".msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names",
  threadAvatarImg: "img.presence-entity__image, .msg-facepile img, img",
  // Thread items LinkedIn marks as unread — used to set is_read on inbound rows.
  threadUnreadClass: "msg-conversation-listitem--unread",

  // ---- conversation pane (right side) ----
  // The list of message bubbles for the currently-open thread.
  messageList: ".msg-s-message-list",
  messageBubble: ".msg-s-event-listitem",
  // LinkedIn appends `--other` to bubbles from the *counterparty*; bubbles
  // sent by the user have no `--other` modifier. Used as the primary
  // direction signal.
  messageOtherClass: "msg-s-event-listitem--other",
  // Sibling-group container that holds consecutive messages from a single
  // sender plus the shared header (sender name, profile link, timestamp).
  messageGroup: ".msg-s-message-group",
  senderName: ".msg-s-message-group__name",
  senderProfileLink: ".msg-s-message-group__profile-link, a[href*='/in/']",
  senderAvatarImg: ".msg-s-message-group__profile-picture, img",
  messageBody: ".msg-s-event-listitem__body",
  timestamp: ".msg-s-message-group__timestamp",
  // <time datetime="..."> element used to recover machine-readable send time;
  // LinkedIn renders these for accessibility next to message-group headers.
  timeElement: "time[datetime]",

  // ---- composer ----
  messageInput: ".msg-form__contenteditable",
  sendButton: ".msg-form__send-button",
};

// Attribute names LinkedIn uses to expose URN identifiers on DOM nodes. They
// vary across LinkedIn UI revisions, so the extractors try each in order
// before falling back to URL parsing.
const LINKEDIN_URN_ATTRS = {
  threadItem: ["data-conversation-urn", "data-conversation-id"],
  messageBubble: ["data-event-urn", "data-msg-event-urn", "id"],
};
