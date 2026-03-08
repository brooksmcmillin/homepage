# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Firefox WebExtension (Manifest v2) that overrides the new tab page with a tasks + news feed dashboard, and provides a sidebar for quick task management. Connects to a backend API at `https://api.nexus.brooksmcmillin.com`.

## Build & Lint Commands

```sh
# Lint (validates manifest + extension structure)
npx web-ext lint --self-hosted

# Build (creates .zip artifact)
npx web-ext build --source-dir=. --artifacts-dir=./artifacts

# Run in Firefox for development (launches a temporary profile)
npx web-ext run

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Architecture

**No bundler, no runtime dependencies.** All files are vanilla JS loaded directly by the browser. Dev dependencies (vitest, jsdom, eslint) are in `package.json` for testing only.

### Script loading contexts

There are three separate execution contexts, each loading `utils.js` first:

1. **Background** (`utils.js` + `background.js`) — Polls task count every 5 minutes, updates toolbar badge, toggles sidebar on icon click. Runs as a background script (not a service worker).
2. **New Tab** (`utils.js` + `newtab.js`) — Full dashboard with greeting, tasks panel (today + overdue), and news feed panel with Featured/All toggle.
3. **Sidebar** (`utils.js` + `sidebar.js`) — Compact task list with auto-refresh. Simpler than new tab (no feed, no greeting).

### Shared utilities (`utils.js`)

All contexts share: `API_BASE`, `DEFAULT_PRIORITY`, `MAX_BACKOFF_MULTIPLIER`, `todayStr()`, `fetchJson()`, `postJson()`. These are globals — no module system.

### CSS

`newtab.css` and `sidebar.css` are independent stylesheets that share the same CSS variable system (color palette, dark mode via `prefers-color-scheme: dark`). They are not shared files — each duplicates the `:root` variables block.

## API Patterns

- All requests use `credentials: "include"` (cookie-based auth)
- API responses have a `.data` property containing the payload
- Key endpoints: `GET /todos`, `POST /todos/{id}/complete`, `GET /news`
- Exponential backoff on failures (base interval × 2^failures, max 8×)

## Code Conventions

- Vanilla JS with global variables per context (no modules)
- HTML escaping via `escapeHtml()` (creates a span, sets textContent, reads innerHTML)
- DOM rendering via innerHTML with escaped content
- Task completion deduplication via a `completingTasks` Set
- CSP enforced via `<meta>` tags in HTML files (no inline scripts allowed)

## Tools

- **Node packages**: managed via `npm` (`package.json`)
- **Python-based CLI tools** (semgrep, zizmor, etc.): install with `uv tool install <package>`, NOT `pip install`. After installation they're available as regular CLI commands.
  ```sh
  uv tool install semgrep
  uv tool install zizmor
  ```

## Release Process

Automated via GitHub Actions on tag push (`v*`):
1. CI validates tag version matches `manifest.json`
2. Builds and signs with Firefox AMO
3. Updates `updates.json` with version, download URL, SHA256
4. Creates GitHub Release

To release: bump version in `manifest.json` and add a new entry in `updates.json` (the deploy workflow will backfill the hash), then tag as `v{version}` and push tag.
