# Architecture Notes

## Acceptance Criteria
- `js/firebase-runtime-config.js` changes must include a cache-busted import chain in the PR diff.
- Keep the fix scoped to cache-bust query parameters only.

## Architecture Decisions
- Preserve runtime Firebase config behavior.
- Treat `firebase.js`, `firebase-images.js`, `db.js`, and `auth.js` as critical browser module links and bump downstream query strings when those modules change.

## Risks And Rollback
- Risk is low because query string changes only invalidate stale browser module cache.
- Rollback is reverting the cache-bust import updates.
