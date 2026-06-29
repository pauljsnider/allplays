# Architecture Notes

## Acceptance Criteria
- Existing-user admin invite smoke test boots `edit-team.html` with mocked dependencies.
- Clicking `#save-admin-btn` calls the mocked invite flow, renders the existing-account status, exposes invite code `EXIST111`, and updates the admin list.

## Architecture Decisions
- Keep the fix in the smoke test dependency stub, not production code. The production page imports `getUserTeamsWithAccess` from `js/db.js?v=76`; the smoke stub for `js/db.js?v=76` omitted that export, which prevents the page module from evaluating and leaves the click handler unregistered.
- Add a no-op `getUserTeamsWithAccess` export to the edit-team DB stub so the module contract matches the page imports.

## Risks And Rollback
- Risk is limited to test harness behavior for one smoke file.
- Rollback by removing the stub export if production imports change and the stub is no longer needed.
