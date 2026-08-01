# Coding Conventions

## 1) Naming Rules

| Item | Rule | Example | Evidence |
| --- | --- | --- | --- |
| Legacy files | Kebab-case HTML/JS filenames | `edit-schedule.html`, `firebase-runtime-config.js` | Root and `js/` |
| React components/pages | PascalCase `.tsx` | `ScheduleEventDetail.tsx` | `apps/app/src/pages/` |
| React helpers/services | camelCase or descriptive lower camel filenames | `scheduleService.ts`, `nativeBackButton.ts` | `apps/app/src/lib/` |
| Functions/methods | `camelCase`, focused verbs | `resolvePrimaryFirebaseConfig` | `js/firebase-runtime-config.js` |
| Types/classes | `PascalCase` | `AppServiceError` | `apps/app/src/lib/appErrors.ts` |
| Constants/env vars | Local constants `camelCase` or `UPPER_SNAKE_CASE`; environment variables uppercase | `redactedValue`, `FIREBASE_PROJECT_ID` | `logger.ts`, MCP server |
| DOM IDs/data keys | Kebab-case and aligned with field meaning | `admin-email` | Legacy pages and `AGENTS.md` |
| Tests | `*.test.js`, `*.test.ts`, or `*.test.tsx`; smoke `*.spec.js` | `logger.test.ts`, `changelog.spec.js` | Test directories |

Follow local style when a mature file differs; do not reformat unrelated legacy
code during a focused change.

## 2) Formatting and Linting

- Legacy: four-space indentation, semicolons, browser ES modules, and direct DOM
  APIs. There is no root-wide formatter/linter.
- React app formatter: Prettier using `apps/app/.prettierrc.json`, 140-column
  print width, single quotes, no trailing commas, and Tailwind class sorting.
- React app linter: ESLint flat config in `apps/app/eslint.config.js`, including
  recommended JavaScript/TypeScript, React, hooks, JSX accessibility, and
  Prettier compatibility.
- TypeScript: strict mode, ES2020 target, bundler resolution in
  `apps/app/tsconfig.json`.
- App commands:

```bash
npm --prefix apps/app run typecheck
npm --prefix apps/app run lint
npm --prefix apps/app run format:check
```

Diff-aware app lint in CI is performed by `scripts/lint-app-ci.mjs`; local full
lint can reveal pre-existing issues beyond the changed files.

## 3) Import and Module Conventions

- Legacy code imports relative browser ES modules. Preserve required cache-bust
  query strings on critical imports.
- App code uses TypeScript ESM and relative imports. `@legacy` is a deliberate
  Vite alias for selected compatibility modules; do not add broad aliases just
  to shorten paths.
- Avoid barrels when they would hide a legacy/native boundary or introduce
  eager imports into the startup path.
- Keep Firebase/native-heavy features dynamically imported when the surrounding
  code does so for startup performance, as in push registration in `App.tsx`.
- Functions are currently CommonJS; do not convert only part of the deployed
  entry point to ESM.

## 4) Error and Logging Conventions

- App services convert unknown/network/permission/not-found/validation failures
  through `AppServiceError` helpers when a stable UI-facing error is needed.
- Preserve `cause` and status for diagnostics, but render a user-safe message.
- App structured logging goes through `apps/app/src/lib/logger.ts`; add useful
  operation/entity context without raw user records.
- The logger recursively redacts authorization, cookies, tokens, API keys,
  secrets, passwords, bearer values, sensitive query assignments, and email
  addresses. Do not bypass it with new `console.*` calls in app code.
- Functions and MCP logging must also avoid request credentials, OAuth grants,
  email/password input, Stripe/Resend secrets, and full private documents.
- Error handling must not turn an authorization failure into an empty-success
  response when the caller needs to distinguish permission from no data.

## 5) Testing Conventions

- Legacy and static contracts live in `tests/unit/`; pure tests may use
  `readFileSync` instead of a browser.
- React app unit/component tests are normally colocated under `apps/app/src/`
  and use `src/setupTests.ts`.
- Firebase rules tests use the emulator and explicit demo project; never point a
  test at production.
- Playwright smoke specs live in `tests/smoke/`; public pages use the shared boot
  helper and registry.
- Mock Firebase and external services at the module/network boundary with
  Vitest mocks. Reset globals and timers in the owning test.
- Every bug fix needs a focused regression. There is no numeric global coverage
  threshold, so green tests are not a substitute for consumer/risk analysis.

## 6) Commit and Handoff Conventions

- Commit messages are short, imperative, and sentence-case.
- Prefer fewer than 500 changed lines and 20 files per PR.
- Keep `external-claim` while code or review fixes are being pushed.
- The ready exact head is a freeze/handoff to PaulBot. Reclaim before any later
  commit and never amend or force-push a handed-off SHA.

## 7) Evidence

- `AGENTS.md`
- `apps/app/.prettierrc.json`
- `apps/app/eslint.config.js`
- `apps/app/tsconfig.json`
- `apps/app/src/lib/logger.ts`
- `apps/app/src/lib/appErrors.ts`
- `apps/app/src/App.tsx`
- `tests/unit/`
- `tests/smoke/`

