# ALL PLAYS Repository Rules

- Treat this as a hybrid repo: legacy static HTML/ES modules at the root, plus a React/TypeScript Capacitor app in `apps/app`.
- Do not duplicate app feature logic separately for web, iOS, and Android. Put shared behavior in `apps/app/src`, with thin Capacitor adapters for native capabilities.
- Keep Firebase Auth, Firestore, and Storage security enforced by rules and existing access helpers; do not bypass access checks client-side.
- For React app changes, run or request `npm run app:build`, focused Vitest coverage in `tests/unit`, and focused Playwright smoke coverage in `tests/smoke/app-*.spec.js`.
- For legacy page changes, preserve existing root HTML/JS patterns and add unit or smoke tests for changed flows.
- GitHub Pages deployment publishes the root site and the React app under `/app/` using `scripts/stage-pages-bundle.mjs`.
- Do not commit service account keys, signing certificates, provisioning profiles, or private secrets. Public Firebase client config is expected.
