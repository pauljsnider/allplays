# QA

## Risk Assessment
- High value regression: admins can advance pool standings from a filtered history view and silently miss downstream bracket updates.
- Main regression risk of the fix: accidental use of practice entries or calendar imports in the tournament planner input.

## Validation Plan
1. Verify the advancement workflow now reads from a full-team game cache.
2. Confirm the full cache is reset on each schedule load and only populated with DB games.
3. Run targeted unit coverage for edit-schedule tournament wiring.
4. Run the full unit suite.

## Commands
- `npm test -- tests/unit/edit-schedule-tournament.test.js tests/unit/tournament-brackets.test.js`
- `npm test`

## Release Recommendation
Safe to ship if targeted and full unit tests pass and the diff remains limited to the schedule wiring change plus run-scoped review artifacts.

## Note
Required role subagent spawns were attempted, but the local gateway timed out, so this QA note was synthesized in the main lane from direct code inspection and test evidence.