Validation target:
- Confirm the source now bounds tournament advancement writes instead of using one unbounded `forEach` batch.
- Run the focused tournament tracker unit tests.

Manual risk checklist:
- Finish flow still commits the primary game batch once.
- Tournament advancement updates still merge into existing `tournament` data.
- Multiple advancement chunks commit in order.

Planned verification:
- `npm test -- --run tests/unit/track-live-tournament.test.js tests/unit/tournament-brackets.test.js`

Residual risk:
- No browser-level manual run in this remediator environment, so validation is limited to targeted unit coverage and source inspection.
