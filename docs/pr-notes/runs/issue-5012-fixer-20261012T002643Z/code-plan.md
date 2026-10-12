# Code plan

> Main-lane synthesis: the required `allplays-code-expert` skill was unavailable and every requested `sessions_spawn` role run failed before execution because the worker reported `published reply runtime missing for main`.

1. Extend the existing app dependency maintenance table in `tests/unit/app-capacitor-native-config.test.js` for the selected app-only updates.
2. Run that focused test before implementation and capture the expected version-mismatch failure.
3. Update the corresponding caret lower bounds in `apps/app/package.json` without changing dependency groups or package-manager conventions.
4. Regenerate `apps/app/package-lock.json` with npm; retain current overrides and avoid lifecycle scripts.
5. Install the app lockfile cleanly and run the focused native-config contract, app test suite, and app typecheck.
6. Review the final diff to ensure only the app manifest/lockfile, the focused contract test, and mandated role artifacts changed.

## Planned app-only versions

- `@capawesome/capacitor-badge` 8.0.4
- `@vitejs/plugin-react` 6.1.2
- `autoprefixer` 10.6.1
- `dompurify` 3.4.16
- `eslint` 9.39.5
- `globals` 17.13.0
- `lucide-react` 1.55.0
- `postcss` 8.5.29
- `prettier` 3.9.10
- `tailwindcss` 4.3.3
- `typescript-eslint` 8.71.1
- `vite` 8.3.4

## Deferred updates to document in the PR

- All newer major versions.
- Same-major updates for root/app shared dependencies, because this issue forbids the root changes needed to preserve alignment.
- React 19.3 type packages while the shared React runtime remains on 19.2.
