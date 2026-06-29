# Architecture Notes

## Acceptance Criteria
- `js/firebase-runtime-config.js` changes are delivered with cache-bust updates through the full browser import chain that loads it.
- Firebase bootstrap entry points and dependent critical modules receive new query-string tokens so browsers do not reuse stale modules.
- No Firebase initialization behavior changes beyond cache invalidation.
- CI `cache-bust-guard` passes against `origin/master...HEAD`.

## Architecture Decisions
- Bump the runtime config module query string in both `js/firebase.js` and `js/firebase-images.js` from `?v=2` to `?v=3`.
- Because those bootstrap modules changed, bump consumers of `firebase.js` from `?v=10` to `?v=11` and consumers of `firebase-images.js` from `?v=3` to `?v=4`.
- Because `js/auth.js` and `js/db.js` import the changed bootstrap modules, bump their browser consumers to `auth.js?v=38` and `db.js?v=76`.
- Do not alter runtime config logic, Firebase project selection, rules, or hosting headers.

## Risks And Rollback
- Risk is limited to browser cache invalidation for Firebase bootstrap modules and dependent modules.
- Rollback is reverting the query-string bumps if the underlying runtime config change is reverted.
