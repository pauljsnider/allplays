# Code plan

Minimal patch: update `tests/smoke/edit-roster-bulk-ai-reset.spec.js` so the db.js route mock matches any cache-busted `db.js` import and includes `getRosterFieldDefinitions()` returning an empty array.

No product code change is needed because the failing assertion is caused by a stale test mock, not the roster image preview implementation.
