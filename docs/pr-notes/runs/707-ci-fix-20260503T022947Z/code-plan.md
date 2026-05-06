# Code Plan

1. Add a small helper in `js/firebase-runtime-config.js` that returns legacy `window` global values only when `window` exists.
2. Use it for `ALLPLAYS_FIREBASE_CONFIG` and `ALLPLAYS_FIREBASE_IMAGE_CONFIG` references.
3. Run affected unit tests and commit with `fix:address-ci-failure: guard firebase runtime globals`.
