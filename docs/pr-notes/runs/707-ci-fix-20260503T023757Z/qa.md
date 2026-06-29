# QA Notes

## Validation Plan
- Run `GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=master node scripts/check-critical-cache-bust.mjs` after commit because the guard compares `origin/master...HEAD`.
- Run `npx vitest run tests/unit/firebase-runtime-config.test.js` to verify the affected runtime config behavior remains intact.
- Run representative auth/db import-mocking tests after the cache-bust token cascade.

## Manual Checks
- Inspect `js/firebase.js` and `js/firebase-images.js` imports to confirm both reference `./firebase-runtime-config.js?v=3`.
- Inspect app/test consumers to confirm `firebase.js?v=11`, `firebase-images.js?v=4`, `auth.js?v=38`, and `db.js?v=76` are used consistently where this cache-bust chain is referenced.
