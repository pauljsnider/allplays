## Current State
- `login.html` imports `./js/auth.js?v=10`, which imports `./firebase.js?v=10`.
- `reset-password.html` imports Firebase exports directly from `./js/firebase.js?v=10`.
- `js/firebase.js` initializes Firebase at module load after resolving runtime config.

## Proposed State
- Introduce a smoke-test helper that collects fatal boot issues:
  - `pageerror`
  - failed script/module requests
  - fatal console errors
  - server responses that indicate broken module/config delivery
- Add one auth smoke spec that exercises:
  - `login.html` real boot path
  - `reset-password.html?mode=resetPassword&oobCode=...` real boot path with mocked invalid-code backend response

## Why This Shape
- It keeps production code untouched unless a real runtime defect is exposed.
- It covers the exact blast radius in the issue: Firebase config/init regressions that happen before any user submits auth actions.
- It keeps the smoke harness maintainable by centralizing boot-failure detection.

## Controls
- No change to auth logic, secrets, or Firebase config values.
- Test-only interception is limited to the reset-code verification request so the page can reach its error state deterministically.
