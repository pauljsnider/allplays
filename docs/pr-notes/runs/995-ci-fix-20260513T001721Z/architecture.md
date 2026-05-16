# Architecture Notes

## Root cause
The team media page added document/file support and now imports `uploadTeamMediaFile`, `isTeamMediaDocument`, and `isSupportedTeamMediaDocument`. The smoke test module stubs for `db.js` and `team-media-utils.js` were not updated to export those symbols, so the page module fails during import and never runs `checkAuth()`/`render()`.

## Decision
Keep production behavior unchanged. Update only the affected smoke test stubs so they match the current module contract.

## Risks and rollback
Low blast radius: test-only change. Rollback is reverting the stub additions if production imports are reverted.
