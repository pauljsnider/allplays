# QA

## Risk Focus
- Regression in newly created team navigation to edit page.
- Regression in edit-team initialization after Team ID UI additions.
- Permission persistence for owners and admins after reload.

## Checks
- Targeted unit test: `npx vitest run tests/unit/edit-team-admin-access-persistence.test.js`
- Full unit suite: `npm run test:unit:ci`

## Expected Coverage Mapping
- Targeted test confirms edit-team harness boots with the Team ID panel present.
- Full suite verifies no broader regressions across auth, invites, calendar, Firebase runtime config, and edit-team related tests.

## Manual Follow-up
- Optional browser smoke: create a team and confirm landing URL is `edit-team.html?teamId=<new-id>` with Team ID panel visible.

## Result
- Targeted test passed.
- Full unit suite passed: 158 files, 691 tests.

## Orchestration Note
- Required subagent spawn was attempted from the main run, but the local gateway timed out before child sessions became usable. This artifact records the QA view for traceability.
