# Code Role Plan (fallback)

1. Add source-level regression tests in `tests/unit/player-soft-delete-policy.test.js`.
2. Run the new test to confirm failure before code change.
3. Patch `js/db.js` `deletePlayer` to soft-delete update semantics.
4. Patch historical pages to request `includeInactive: true`.
5. Add roster UI copy in `edit-roster.html` explaining delete/deactivate semantics.
6. Run unit tests and commit all changes with issue reference.
