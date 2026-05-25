# Repository Guidelines

## Project Structure & Module Organization
- Root HTML pages (e.g., `index.html`, `dashboard.html`, `track.html`) are entry points for screens and flows.
- Shared frontend logic lives in `js/` as ES modules (e.g., `js/auth.js`, `js/db.js`, `js/utils.js`).
- Global styling is in `css/`, images and logos in `img/`.
- The React/TypeScript app lives in `apps/app/` and is packaged for web at `/app/` plus iOS/Android through Capacitor.
- Native Capacitor shells live in `ios/` and `android/`; keep native edits thin and put shared app logic in `apps/app/src/`.
- Product specs and feature notes are kept in `spec/` and `_project-docs/`.
- Firebase configuration and rules are in `firebase.json`, `firestore.rules`, and `firestore.indexes.json`.

## Build, Test, and Development Commands
Legacy HTML site:
- `python3 -m http.server` — quick local server on port 8000.
- `npx http-server .` — alternative Node-based server.

React/Capacitor app:
- `npm run app:dev` — Vite dev server for `apps/app` on port 5174.
- `npm run app:build` — TypeScript check and Vite production build.
- `npm run mobile:sync` — build the React app and sync Capacitor assets/plugins.
- `npm run mobile:build:ios` — local iOS simulator build.
- `npm run mobile:build:android` — local Android debug build.

Open legacy pages at `http://localhost:8000`. Open the app locally at `http://localhost:5174`.

## Coding Style & Naming Conventions
- Legacy HTML/JS indentation: 4 spaces; use semicolons and ES module imports.
- React app indentation follows the existing `apps/app` TypeScript/JSX style; keep shared behavior in reusable `apps/app/src/lib` helpers.
- Naming: `camelCase` for variables/functions, `PascalCase` for classes (when used).
- Keep DOM IDs and data keys consistent with HTML names (e.g., `admin-email` ↔ `#admin-email`).
- Prefer small, focused functions in `js/` modules; reuse helpers in `js/utils.js`.
- Do not duplicate feature logic separately for web, iOS, and Android. Put app feature behavior in `apps/app/src/` and use Capacitor adapters only for native capabilities.

## Testing Guidelines

### Test suite overview
The repo has two automated test tiers:

| Tier | Framework | Location | Run command |
|------|-----------|----------|-------------|
| Unit | Vitest | `tests/unit/` | `npm test` |
| Smoke (E2E) | Playwright | `tests/smoke/` | `npm run test:smoke` |

### Unit tests (`tests/unit/`)
- Use `readFileSync` to read HTML and JS files from the repo root — no DOM or browser needed.
- Test pure logic extracted into JS modules, and assert on HTML structure/content of static pages.
- Mock Firebase and external deps with `vi.fn()` / `vi.mock()`.
- Run a single file during development: `npx vitest run tests/unit/my-file.test.js --reporter=verbose`

### Smoke tests (`tests/smoke/`)
- Use Playwright against a live server (`npm run serve:firebase` or `python3 -m http.server`).
- Use `assertPageBootsWithoutFatalErrors` from `helpers/boot-path.js` for standard boot checks.
- Register new public pages in `tests/smoke/page-registry.js` → `getPublicSmokePages()`.
- Write a dedicated spec file (e.g., `tests/smoke/changelog.spec.js`) for interactive behaviors — search, filters, modals, toggles.

### What to write for each change
- **New JS module:** unit test covering the exported functions and error branches.
- **New React app helper:** unit test in `tests/unit/` and focused Playwright smoke when it changes a user flow.
- **New static HTML page:** unit test checking structure, data attributes, JS wiring, and internal link targets; smoke test checking boot, key selectors, and interactive behaviors.
- **Bug fix:** add a regression unit test that fails before the fix and passes after.
- **UI flow change:** update or extend the relevant smoke spec.

### Manual test pages (legacy)
HTML test pages in the repo root (`test-foul-tracking.html`, `test-pr-changes.html`, etc.) remain valid for quick visual checks. `PR-TESTING-GUIDE.md` and `FOUL-TRACKING-TEST-GUIDE.md` cover critical manual flows not yet covered by automation.

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
- Public Firebase config in app/native bundles is expected; do not commit service account keys, private API keys, provisioning profiles, or signing certificates.
- GitHub Pages deployment uses `.github/workflows/app-github-pages.yml` and `scripts/stage-pages-bundle.mjs` to publish the legacy site root plus the React build under `/app/`.
