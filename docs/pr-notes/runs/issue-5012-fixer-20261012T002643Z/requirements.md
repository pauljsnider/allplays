# Requirements analysis

> Main-lane synthesis: the required `allplays-requirements-expert` skill was unavailable and every requested `sessions_spawn` role run failed before execution because the worker reported `published reply runtime missing for main`.

## Acceptance contract

- Update only direct dependencies declared by `apps/app/package.json`, and regenerate only `apps/app/package-lock.json`.
- Keep every dependency on its current major version and preserve existing caret versus exact-pin conventions.
- Do not change root dependencies, native manifests, GitHub Actions, generated bundles, or application behavior.
- Extend the existing static dependency contract test so the selected versions must agree between the app manifest, the lockfile root, and installed lockfile entries.
- Run the complete app Vitest suite and the focused Capacitor/native configuration contract.

## Scope decisions

- Update app-only packages with available same-major releases: `@capawesome/capacitor-badge`, `@vitejs/plugin-react`, `autoprefixer`, `dompurify`, `eslint`, `globals`, `lucide-react`, `postcss`, `prettier`, `tailwindcss`, `typescript-eslint`, and `vite`.
- Defer packages shared with the root package even when a newer same-major release exists. Moving them only in the app would violate the existing cross-manifest/native alignment contract, while changing the root is explicitly out of scope.
- Defer major releases of `@eslint/js`, `eslint`, `@sentry/browser`, `@vitest/coverage-v8`, `firebase`, `typescript`, and `vitest` where applicable.

## User and product impact

This is maintenance-only. No route, screen, workflow, copy, permissions, or native project configuration should change.
