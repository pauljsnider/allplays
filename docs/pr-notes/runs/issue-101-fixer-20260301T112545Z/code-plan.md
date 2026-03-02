# Code Role Output

## Minimal Patch Plan
1. Extract signup core logic into a dependency-injected helper exported from `js/auth.js` so unit tests can isolate behavior.
2. Add new unit tests for parent-invite success and parent-invite failure propagation.
3. Update `signup()` to call helper with production dependencies.
4. Ensure parent-invite catch rethrows error so caller does not redirect.
5. Run targeted Vitest file and confirm pass.

## Conflict Resolution
- Requirements/Architecture/QA agree on fail-fast behavior for parent-invite errors.
- Implementation remains narrow: no login page changes required because existing caller already handles thrown errors.
