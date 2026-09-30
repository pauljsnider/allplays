# Technology Stack

This document describes the active stack as observed on 2026-07-25.

## 1) Runtime Summary

| Area | Value | Evidence |
| --- | --- | --- |
| Legacy web | HTML5, CSS, JavaScript ES modules in the browser | Root `*.html`, `js/firebase.js`, `js/db.js` |
| App web/native | React 19, TypeScript 6, Vite 8, Tailwind 4, Capacitor 8 | `apps/app/package.json`, `apps/app/vite.config.ts`, `capacitor.config.json` |
| Backend | Firebase Functions CommonJS on Node 20 | `functions/package.json`, `firebase.json` |
| ChatGPT integration | Express 5 and MCP SDK on Node 22 | `services/chatgpt-mcp/package.json`, `services/chatgpt-mcp/src/server.js` |
| Data/auth/hosting | Firebase Auth, Firestore, Storage, Functions, Hosting | `firebase.json`, `firestore.rules`, `storage.rules` |
| Root/app tool runtime | Node 22+, npm 10+ | `package.json`, `apps/app/package.json` |
| Package manager | npm with separate root, app, Functions, and MCP lockfiles | `package-lock.json`, nested `package-lock.json` files, `.github/workflows/ci.yml` |
| Module/build system | Browser ESM for legacy, Vite ESM for app, CommonJS Functions | `package.json`, `apps/app/vite.config.ts`, `functions/package.json` |

GitHub Actions and all documented commands use npm. `package-lock.json` is the
only package-manager lockfile contract; do not introduce a pnpm/Yarn lockfile
or package-manager workspace without an explicit repository migration.

No Dockerfile, container build, or repository-owned base image is present. The
deployed server runtimes are selected by Firebase Functions and the MCP
service's Cloud Run environment rather than a checked-in container definition.

## 2) Production Frameworks and Dependencies

| Dependency | Version family | Role in system | Evidence |
| --- | --- | --- | --- |
| Firebase Web SDK | 12.16 | Auth, Firestore, Storage, Messaging, App Check | `package.json`, `apps/app/package.json` |
| React / React DOM | 19.2 | React app rendering | `apps/app/package.json` |
| React Router | 7.18 | Hash-routed web/native app navigation | `apps/app/package.json`, `apps/app/src/main.tsx` |
| Vite | 8.1 | App development and production bundling | `apps/app/package.json`, `apps/app/vite.config.ts` |
| Capacitor | 8.x | Shared web bundle in iOS and Android shells | `package.json`, `capacitor.config.json` |
| Firebase Functions/Admin | 5.1 / 12.7 | Serverless business logic and privileged data operations | `functions/package.json`, `functions/index.js` |
| Stripe | 16.12 | Team Pass checkout and webhook processing | `functions/package.json`, `functions/index.js` |
| Resend | 6.17 | Transactional email delivery | `functions/package.json`, `functions/index.js` |
| Express | 5.1 | Remote MCP HTTP service | `services/chatgpt-mcp/package.json` |
| MCP SDK | 1.12 | ChatGPT-compatible tools transport | `services/chatgpt-mcp/package.json`, `services/chatgpt-mcp/src/server.js` |
| DOMPurify | 3.4 | App-side untrusted HTML sanitization | `apps/app/package.json` |
| Sentry Browser | 10.x | Optional app error telemetry | `apps/app/package.json`, `apps/app/src/lib/telemetry.ts` |

## 3) Development Toolchain

| Tool | Purpose | Evidence |
| --- | --- | --- |
| Vitest 4.1 | Root, rules, Functions, and app unit/component tests | `package.json`, `vitest.config.ts`, `apps/app/vite.config.ts` |
| Playwright 1.62 | Local/staged/production smoke and visual regression | `package.json`, `playwright.smoke.config.js` |
| TypeScript 6 | Strict app type checking | `apps/app/tsconfig.json` |
| ESLint 9 | React/TypeScript, hooks, and accessibility checks | `apps/app/eslint.config.js` |
| Prettier 3 | App formatting and Tailwind class ordering | `apps/app/.prettierrc.json` |
| Firebase CLI 15 | Emulators, validation, and deployments | `package.json`, GitHub workflows |
| Android Gradle / Java 21 | Android debug/release builds | `android/`, `.github/workflows/mobile-build.yml` |
| Xcode / SwiftPM | iOS simulator/release builds | `ios/`, `.github/workflows/mobile-build.yml` |

There is no safe root-wide lint or formatting command for legacy HTML/JS. App
linting is intentionally scoped to `apps/app`.

## 4) Key Commands

```bash
npm ci
npm ci --prefix apps/app
npm ci --prefix functions

npm test
npm run test:unit:ci
npm --prefix apps/app run test:ci
npm run test:smoke

npm run app:dev
npm run app:build
npm run app:check-bundle-size

npm run mobile:sync
npm run mobile:build:android
npm run mobile:build:ios
```

The MCP service is separate:

```bash
npm ci --prefix services/chatgpt-mcp
npm start --prefix services/chatgpt-mcp
```

## 5) Environment and Config

- Browser runtime config resolves from Firebase Hosting
  `/__/firebase/init.json`, `window.__ALLPLAYS_CONFIG__`, selected legacy window
  globals, `.well-known/allplays-runtime-config.json`, and bundled public
  fallbacks in `js/firebase-runtime-config.js`.
- App build-time public settings use `VITE_*` or staging variables, principally
  App Check and FCM values. Vite-exposed values must never contain secrets.
- Functions use Firebase runtime configuration and environment/secrets for
  Stripe, Resend, Sports Connect, verified-email policy, calendar access,
  payments, and image storage.
- The MCP service requires `FIREBASE_PROJECT_ID` and `FIREBASE_WEB_API_KEY`.
  Production also requires the Firestore grant-store project/database and
  `OAUTH_GRANT_ENCRYPTION_KEY`; memory grants and `DEV_FALLBACK_BEARER` are
  rejected in production.
- GitHub deploys authenticate to Google Cloud through OIDC after artifact
  verification. Mobile releases use protected signing secrets.
- `[TODO]` There is no repository-wide `.env.example`; use the owning
  integration README/runbook and workflow as the source of truth.

## 6) Evidence

- `package.json`
- `apps/app/package.json`
- `apps/app/vite.config.ts`
- `functions/package.json`
- `services/chatgpt-mcp/package.json`
- `js/firebase-runtime-config.js`
- `firebase.json`
- `.github/workflows/ci.yml`
- `.github/workflows/mobile-build.yml`
