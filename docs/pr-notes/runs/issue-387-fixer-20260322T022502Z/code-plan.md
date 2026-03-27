Thinking level: medium
Reason: page-local bug with module-mocked browser coverage and a small DOM-state fix.

Implementation plan:
1. Add a dedicated Playwright spec under `tests/smoke/` for the Bulk AI cancel/reset workflow.
2. Mock `db.js`, `auth.js`, `utils.js`, `team-access.js`, `team-admin-banner.js`, `firebase-app.js`, and `firebase-ai.js` via request interception so the real page can load without backend dependencies.
3. Prove the current bug by asserting cancel does not fully reset input state.
4. Add a `resetBulkAiInputState()` helper in `edit-roster.html` and invoke it from Cancel and successful Apply reset paths.
5. Re-run the focused browser test and the unit suite if practical, then commit the targeted changes.
