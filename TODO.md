# Homepage Extension - Feature Ideas

## Done

- [x] Badge count - show due-today + overdue count on extension icon
- [x] Sidebar panel - persistent task list in Firefox sidebar

## Low-Hanging Fruit

- [ ] Quick-add task - popup or keyboard shortcut to create a task from any page, pre-fill current URL in description
- [ ] Complete tasks from new tab - inline checkboxes on due-today list to mark done without navigating
- [ ] Project progress bars - show completion % from `/api/projects/{id}/stats` on new tab
- [ ] Keyboard shortcut to add task - `Ctrl+Shift+T` or similar to open quick-add from any page

## Medium Effort

- [ ] Context menu: "Create task from selection" - right-click highlighted text to create task with that text + page URL
- [ ] Context menu: "Save to feeds" - right-click a page to add as feed source or one-off article
- [ ] Page analyzer - toolbar button to summarize/analyze current page via agents' `analyze_website` tool

## Ambitious

- [ ] Agent chat popup - small chat window using agents REST API (`/agents/{name}/message`) for quick queries from any page
- [ ] Save to RAG - right-click to save page/selection to RAG knowledge base via agents' `add_document` tool
- [ ] Email triage widget - unread count + recent emails panel on new tab via agents' FastMail integration
- [ ] Notification system - browser notifications for overdue tasks, agent completions, high-priority articles
