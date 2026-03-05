# Code role synthesis (local fallback)

## Minimal patch plan
1. Add `js/bracket-management.js` with seeded single-elim builder, result progression, and publish projection helpers.
2. Add unit tests in `tests/unit/bracket-management.test.js` that fail until helper exists.
3. Extend `js/db.js` with bracket CRUD/list/publish wrappers.
4. Extend `firestore.rules` for bracket collection access.
5. Run targeted vitest for new tests.
