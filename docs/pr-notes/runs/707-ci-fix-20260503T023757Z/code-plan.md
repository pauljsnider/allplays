# Code Plan

## Root Cause
- `js/firebase-runtime-config.js` changed in the PR, but the browser import chain still referenced the old cache-bust token.
- Updating `js/firebase.js` and `js/firebase-images.js` to load the new runtime config token also requires bumping dependent critical modules and their consumers.

## Implementation Plan
- Update `js/firebase.js` and `js/firebase-images.js` imports of `firebase-runtime-config.js` from `?v=2` to `?v=3`.
- Update app and test consumers of `firebase.js` from `?v=10` to `?v=11`.
- Update app consumers of `firebase-images.js` from `?v=3` to `?v=4`.
- Update app and test consumers of `auth.js` to `?v=13` and `db.js` to `?v=29` where the cache-bust chain is referenced.
- Run the cache-bust guard and targeted runtime config/import tests.
