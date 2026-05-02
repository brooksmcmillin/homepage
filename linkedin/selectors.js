// LinkedIn messaging UI selectors. LinkedIn ships unannounced class-name
// changes; routing all DOM queries through this module keeps breakage
// localized to one file. The runtime self-test (task #1308) reports any
// selector that returns zero matches so the canary is loud.
const LINKEDIN_SELECTORS = {
  threadList: ".msg-conversations-container__conversations-list",
  threadItem: ".msg-conversation-listitem",
  messageBubble: ".msg-s-event-listitem",
  senderName: ".msg-s-message-group__name",
  messageBody: ".msg-s-event-listitem__body",
  timestamp: ".msg-s-message-group__timestamp",
  messageInput: ".msg-form__contenteditable",
  sendButton: ".msg-form__send-button",
};
