# Architecture Notes

## Root cause
`resolvePrimaryFirebaseConfig()` protects `window.__ALLPLAYS_CONFIG__` through `readGlobalConfig()`, but then directly reads `window.ALLPLAYS_FIREBASE_CONFIG`. In Vitest's default node environment, importing `js/team-pass.js` imports `js/firebase.js`, which awaits `resolvePrimaryFirebaseConfig()` before any DOM/window shim exists. That direct `window` reference throws before fallback config can run.

## Decision
Keep runtime config browser-compatible and Node-safe by reading legacy globals only when `typeof window !== 'undefined'`. Do not change Firebase initialization or team pass behavior.

## Risks and rollback
Low risk. The change only preserves existing lookup order while avoiding a ReferenceError in non-browser environments. Rollback is the single guard change in `js/firebase-runtime-config.js`.
