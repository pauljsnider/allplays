# Code Role (allplays-code-expert)

## Plan
1. Add `tests/unit/edit-config-delete-guard.test.js` to pin the new data-layer guard and UI error handling.
2. Update `js/db.js` so `deleteConfig(teamId, configId)` refuses deletion when any team game still references that config.
3. Update `edit-config.html` to catch delete failures, alert the admin, and keep the config list intact.
4. Run focused vitest coverage for the new test and nearby edit-config tests, then commit with the issue reference.

## Non-Goals
- No migration of existing games.
- No tracker fallback refactor.
