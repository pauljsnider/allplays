# Architecture Notes

## Context
PR #658 unit tests fail after `edit-team.html` changed its module imports.

## Decision
Keep the production `edit-team.html` dependency graph unchanged. The page now imports `normalizeTeamPermissions` from `./js/team-access.js?v=2` and `getAllUsers` from `./js/db.js?v=76`; those imports are required by the current page script.

## Minimal Fix
Update unit-test wiring/extraction expectations to match the current production imports instead of reverting cache-busting or removing needed imports.

## Risks And Rollback
Risk is limited to unit test harness alignment. Rollback is reverting the test-only changes if a later production import change supersedes them.
