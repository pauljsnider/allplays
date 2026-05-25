# App Guidelines

## Scope
- This directory contains the React/TypeScript ALL PLAYS app used for web at `/app/` and for iOS/Android through Capacitor.
- Shared app behavior belongs in `src/lib/`; native-specific work should stay in thin Capacitor adapters.
- Keep the web, iOS, and Android experiences on the same React routes instead of forking feature logic per platform.

## Commands
- `npm run app:dev` from the repo root starts the Vite app on port 5174.
- `npm run app:build` from the repo root runs TypeScript and Vite production build.
- `npm run mobile:sync` from the repo root builds and syncs Capacitor.
- `npm run mobile:build:ios` and `npm run mobile:build:android` run local native build checks.

## Testing
- Put app unit tests in root `tests/unit/`, importing app helpers from `apps/app/src/`.
- Put app Playwright flows in root `tests/smoke/app-*.spec.js`.
- For user-facing app changes, run the targeted unit tests, `npm run app:build`, and the relevant app smoke spec with `SMOKE_APP_BASE_URL`.
- Production boot coverage for `https://allplays.ai/app/` lives in `tests/smoke/app-production-bootstrap.spec.js`.

## UX And Implementation
- Keep mobile-first layouts compact and parent-focused, but make desktop browser layouts comfortable when the app is hosted at `/app/`.
- Prefer existing app components, route patterns, and visual tokens over new one-off UI styles.
- Do not import full legacy HTML pages into the React app. Reuse portable data contracts and helper logic instead.
- Keep native permissions, Google auth, push, sharing, media upload, and dictation behind small adapter functions.

## Deployment
- Vite uses relative assets (`base: './'`) so the build works under `/app/`.
- GitHub Pages and Firebase preview/prod workflows stage the root static site plus `apps/app/dist` through `scripts/stage-pages-bundle.mjs`.
