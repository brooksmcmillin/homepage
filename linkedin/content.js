// Content script entry for LinkedIn messaging.
// Loaded on https://www.linkedin.com/messaging/* via manifest content_scripts;
// linkedin/selectors.js is loaded first and exposes LINKEDIN_SELECTORS.
//
// Firefox isolation note: content scripts see page DOM through Xray wrappers.
// Interacting with React (calling React-tracked input setters, dispatching
// events the page listens for, reading page-defined globals) needs
// `window.wrappedJSObject` to bypass the wrapper. Chromium has no wrapper
// and the property is undefined. Tasks #1305 / #1307 wire up the actual
// scrape + send paths against this constraint.

console.log(
  "[homepage:linkedin] content script loaded on",
  location.pathname,
);
