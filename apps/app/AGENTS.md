# React/Capacitor App Instructions

These instructions add to the repository-root `AGENTS.md` for work under
`apps/app/`.

## Scope and Boundaries

- `src/main.tsx` owns startup instrumentation, the root error boundary, native
  appearance, and the `HashRouter`.
- `src/App.tsx` owns route composition, authentication protection, lazy page
  loading, deep links, push-open routing, and native back behavior.
- Put route components in `src/pages`, reusable UI in `src/components`, hooks in
  `src/hooks`, and data/domain/platform behavior in `src/lib`.
- Keep native capabilities behind focused adapters or helpers. Do not fork an
  entire feature for web, iOS, and Android.
- `src/lib/adapters` imports selected legacy modules through the `@legacy`
  Vite alias. Changing a legacy contract requires checking its typed adapter and
  all app consumers.
- Vite uses `base: './'`; do not change it without verifying web `/app/`,
  Firebase preview, GitHub Pages staging, and both native shells.

## Commands

Run through npm; `package-lock.json` is canonical. Do not introduce a
pnpm/Yarn lockfile or package-manager workspace.

```bash
npm ci --prefix apps/app
npm run app:dev
npm --prefix apps/app run typecheck
npm --prefix apps/app run lint
npm --prefix apps/app run format:check
npm --prefix apps/app run test:ci
npm run app:build
npm run app:check-bundle-size
```

For one test:

```bash
npm --prefix apps/app exec -- vitest run src/lib/example.test.ts --reporter=verbose
```

`npm run app:build` performs strict TypeScript checking, produces the Vite
bundle, and verifies `bundle-visualizer.html`. Do not commit changes to that
generated report.

## Tests and UX

- Co-locate app unit/component tests as `*.test.ts` or `*.test.tsx` under
  `src/`. Use the established `src/setupTests.ts` jsdom environment.
- Put cross-surface static contracts in root `tests/unit/` and browser flows in
  `tests/smoke/app-*.spec.js`.
- For a user-flow change, run the focused unit test, `npm run app:build`, and the
  relevant Playwright spec with `SMOKE_APP_BASE_URL` when required.
- Preserve loading, empty, permission, offline/network, retry, and native
  behavior for service changes. Use existing `AppServiceError` and logger
  conventions where present.
- Reuse existing components, layout tokens, and route patterns. Keep layouts
  mobile-first without making the `/app/` desktop experience cramped.
- Use semantic controls, labels, keyboard access, visible focus, and sufficient
  contrast. The app ESLint config includes React hooks and JSX accessibility
  rules.

## CI Impact

Changes under `apps/app/` trigger app quality, staged preview smoke, and both
native debug builds. Root or app lockfile changes can also trigger native work.
The stable `preview-smoke` and `mobile-build` jobs are the required aggregate
signals; diagnose their dependencies before rerunning them.

App Check and runtime config values are injected while staging artifacts.
Never embed a debug token in a production build, expose secrets in Vite
variables, or bypass production artifact guards.
