# Code Role Plan

## Patch Scope
- Add `js/firebase-runtime-config.js` for normalized runtime config loading.
- Update `js/firebase.js` to initialize from `await resolvePrimaryFirebaseConfig()`.
- Update `js/firebase-images.js` to initialize from `resolveImageFirebaseConfig()`.
- Update README setup section to document runtime config contract.

## Conflict Resolution Across Roles
- Requirements requested no hardcoded config and clear acceptance checks.
- Architecture preferred shared resolver over duplicated logic.
- QA highlighted startup failure risk when config is absent.
- Final implementation keeps strict validation with clear error text and documents required runtime keys.
