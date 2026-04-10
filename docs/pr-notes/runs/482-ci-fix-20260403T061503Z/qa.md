# QA Role Notes

- Root cause: `tests/unit/edit-config-delete-guard.test.js` asserted an exact source string that no longer matched after the shared-game guard was added.
- Cache-bust risk: `js/db.js` changed in the PR diff without a matching `db.js?v=` bump in changed imports, which trips `scripts/check-critical-cache-bust.mjs`.
- Validation target: run the focused unit test file and the cache-bust guard script; confirm the smoke stub matches the new `edit-config.html` import.
