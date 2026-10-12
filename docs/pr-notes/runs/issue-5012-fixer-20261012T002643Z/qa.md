# QA analysis

> Main-lane synthesis: the required `allplays-qa-expert` skill was unavailable and every requested `sessions_spawn` role run failed before execution because the worker reported `published reply runtime missing for main`.

## Regression strategy

- Expand the existing `keeps app dependency maintenance updates aligned` case in `tests/unit/app-capacitor-native-config.test.js` with every package changed by this slice.
- Require the expected specifier in both `apps/app/package.json` and the lockfile root, plus the exact resolved version at `node_modules/<package>` in `apps/app/package-lock.json`.
- Demonstrate the regression test fails after updating expectations but before changing the manifest and lockfile.

## Validation

1. `npx vitest run tests/unit/app-capacitor-native-config.test.js`
2. `npm --prefix apps/app run test:ci`
3. `npm --prefix apps/app run typecheck` as a focused compatibility check for TypeScript-facing dependency updates.
4. `npm --prefix apps/app install --package-lock-only --ignore-scripts` followed by a clean install check to prove lockfile reproducibility.

## Risks and guardrails

- A stale lock root can appear correct while the installed package entry differs; the contract checks both representations.
- Vite/plugin and Tailwind/PostCSS updates are coupled, so typecheck plus the app suite should run against a clean app install.
- No native manifest changed, and all shared native packages are deferred, so Android Gradle and Xcode builds are intentionally left to CI.
