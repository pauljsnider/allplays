# QA

## Test Strategy
- Verify staff tools show the tournament entry point.
- Verify opening the entry point shows a tournament dialog.
- Verify cancel and close dismiss the dialog without calling the tournament create service.
- Verify reopen starts with a clean draft.

## Regression Risks
- Missing staff-only gating.
- Hidden persistence on cancel.
- Stale draft state on reopen.

## Minimum Automated Test Coverage
- Open shell from staff tools.
- Cancel without writes.
- Dismiss via close control without writes.
- Reopen with empty draft state.

## Manual Checks
- Open Schedule as staff.
- Launch tournament shell.
- Enter sample values, cancel, reopen, confirm draft reset.
- Confirm no new tournament appears after cancel.
