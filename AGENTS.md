# Repository Guidelines

## Project Structure & Module Organization
- Root HTML pages (e.g., `index.html`, `dashboard.html`, `track.html`) are entry points for screens and flows.
- Shared frontend logic lives in `js/` as ES modules (e.g., `js/auth.js`, `js/db.js`, `js/utils.js`).
- Global styling is in `css/`, images and logos in `img/`.
- Product specs and feature notes are kept in `spec/` and `_project-docs/`.
- Firebase configuration and rules are in `firebase.json`, `firestore.rules`, and `firestore.indexes.json`.

## Build, Test, and Development Commands
This is a static site; run any local static server from repo root:
- `python3 -m http.server` — quick local server on port 8000.
- `npx http-server .` — alternative Node-based server.
Open `http://localhost:8000` (or the printed port) and navigate to the HTML page you’re working on.

## Coding Style & Naming Conventions
- Indentation: 4 spaces; use semicolons and ES module imports.
- Naming: `camelCase` for variables/functions, `PascalCase` for classes (when used).
- Keep DOM IDs and data keys consistent with HTML names (e.g., `admin-email` ↔ `#admin-email`).
- Prefer small, focused functions in `js/` modules; reuse helpers in `js/utils.js`.

## Testing Guidelines
- There is no automated test runner in this repo.
- Use the manual test guides when available:
  - `PR-TESTING-GUIDE.md` for critical flows (auth, basketball tracker, etc.).
  - `FOUL-TRACKING-TEST-GUIDE.md` for foul-tracking scenarios.
- When changing user flows, document a short manual test plan in your PR.

## Commit & Pull Request Guidelines
- Recent commit messages are short, imperative, and sentence-case (e.g., “Fix bugs found in code review”).
- PRs should include:
  - What changed and why (bullet summary).
  - Manual test steps executed, with affected pages (e.g., `edit-schedule.html`, `login.html`).
  - Screenshots or short clips for UI changes when relevant.

## Security & Configuration Tips
- Admin access is controlled by the `isAdmin` field in Firestore; don’t bypass it client-side.
- Update Firebase web config in `js/firebase.js` and `js/firebase-images.js` when changing projects.
- Ensure Auth authorized domains include local dev and the deployed host.
