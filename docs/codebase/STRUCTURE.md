# Codebase Structure

## 1) Top-Level Map

| Path | Purpose | Evidence |
| --- | --- | --- |
| Root `*.html` | Legacy page entry points such as dashboard, schedule, teams, tracking, and reports | `README.md`, `index.html`, `dashboard.html`, `track.html` |
| `js/` | Legacy ES modules, Firebase access, shared domain/UI helpers, trackers | `js/auth.js`, `js/db.js`, `js/utils.js` |
| `css/`, `img/` | Legacy global styles, logos, and images | `css/styles.css`, `img/` |
| `apps/app/` | React/TypeScript application and app-specific tooling | `apps/app/src/main.tsx`, `apps/app/package.json` |
| `ios/`, `android/` | Thin Capacitor native shells and platform configuration | `capacitor.config.json`, native project files |
| `functions/` | Active deployed Firebase Functions and backend tests | `firebase.json`, `functions/package.json`, `functions/index.js` |
| `services/chatgpt-mcp/` | Read-only remote MCP/OAuth service | `services/chatgpt-mcp/README.md`, `services/chatgpt-mcp/src/server.js` |
| `tests/unit/` | Legacy, static contract, cross-surface, and emulator-backed tests | `vitest.config.ts`, `tests/unit/` |
| `tests/smoke/` | Playwright local, staged, visual, candidate, and production tests | `playwright.smoke.config.js`, `tests/smoke/` |
| `scripts/` | CI, artifact staging, deployment validation, and operational helpers | Root `package.json`, GitHub workflows |
| `_migration/` | One-off privileged Firestore repair/backfill scripts | `_migration/MIGRATION-README.md` |
| `spec/`, `_project-docs/` | Feature requirements, designs, tasks, and rollout notes | `spec/`, `_project-docs/` |
| `docs/` | Runbooks, architecture evidence, landing policy, and generated PR history | `docs/landing-process.md`, `docs/codebase/` |
| `.github/workflows/` | PR validation, preview, production, release, and health automation | Workflow files |

`docs/pr-notes/runs/` is generated historical evidence and is unusually large.
Exclude it from general source discovery unless investigating a specific run.

## 2) Entry Points

- Legacy web entry points are selected directly by URL; each root HTML page
  imports its required modules from `js/`.
- React web/native startup is `apps/app/src/main.tsx`, which renders
  `apps/app/src/App.tsx` through a `HashRouter`.
- Firebase Functions use `functions/index.js`, selected by
  `functions/package.json` and the root `firebase.json`.
- The MCP HTTP process uses `services/chatgpt-mcp/src/server.js`, selected by its
  package `start` script.
- iOS and Android load the Vite output at `apps/app/dist`, configured by
  `capacitor.config.json`.
- CI/deployment jobs are selected by workflow event and path classification in
  `.github/workflows/`.

There is no alternate app or Functions source tree. The React app under
`apps/app/src/` and the backend under `functions/` are the only active
production implementations.

## 3) Module Boundaries

| Boundary | What belongs here | What must not be here |
| --- | --- | --- |
| Root HTML | Page structure and minimal page wiring | Repeated reusable business/data logic |
| `js/` | Legacy shared behavior and browser Firebase access | Service-account operations or private secrets |
| `apps/app/src/pages` | Route-level composition and user flows | Large reusable data-access implementations |
| `apps/app/src/components` | Reusable view components and app shell | Direct duplication of feature data rules |
| `apps/app/src/lib` | Services, domain logic, hooks support, adapters, platform helpers | Whole native-platform feature forks |
| `apps/app/src/lib/adapters` | Typed compatibility with legacy modules | New parallel business rules when a shared helper exists |
| `functions/` | Server-side integrations, triggers, callable/HTTP functions | Client-only navigation or UI logic |
| `services/chatgpt-mcp/` | Read-only user-scoped tool/OAuth behavior | Privileged application-data reads |
| `firestore.rules`, `storage.rules` | Enforced authorization and validation | UI-only assumptions |
| `scripts/` | Reusable CI/deploy/operations mechanics | Product runtime behavior |
| `_migration/` | Explicit one-time data changes | Automatically executed application startup code |

## 4) App Deep Map

| App path | Responsibility |
| --- | --- |
| `src/main.tsx` | Startup telemetry, web vitals, native appearance, error boundary, router |
| `src/App.tsx` | Routes, protected screens, native back/deep links/push navigation |
| `src/pages/` | Auth, home, schedule, teams, messages, profile, tracking, parent tools |
| `src/components/` | App shell, navigation, forms, cards, error/loading UI |
| `src/lib/` | Business/data services and cross-cutting helpers |
| `src/lib/adapters/` | Legacy JS compatibility through Vite `@legacy` alias |
| `src/lib/firestore/` | Focused Firestore utilities |
| `src/lib/sportScoring/` | Sport-specific scoring behavior behind shared contracts |
| `src/setupTests.ts` | jsdom test setup |

## 5) Naming and Organization Rules

- Legacy modules and pages generally use kebab-case filenames; variables and
  functions use `camelCase`.
- React components/pages use `PascalCase.tsx`; app helpers use
  `camelCase.ts`; colocated tests use `*.test.ts` or `*.test.tsx`.
- App code normally uses relative imports. Vite reserves `@legacy` for selected
  root legacy module reuse.
- Keep generated artifacts out of source edits: `node_modules/`, Playwright
  `test-results/`, staged deploy directories, native build output, and
  `apps/app/bundle-visualizer.html`.

## 6) Evidence

- `README.md`
- `firebase.json`
- `capacitor.config.json`
- `apps/app/src/main.tsx`
- `apps/app/src/App.tsx`
- `apps/app/vite.config.ts`
- `functions/package.json`
- `services/chatgpt-mcp/src/server.js`
- `.github/workflows/`
