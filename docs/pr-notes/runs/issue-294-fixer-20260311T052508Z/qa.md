Validation focus:
- Parent RSVP on `calendar.html` submits only the clicked event's scoped child ids.
- Existing parent dashboard RSVP scope tests still pass.
- No regression for single-child event fallback.

Regression guards:
- Unit test for aggregated event `childIds` resolution.
- Unit test for explicit `childIds` payload being filtered to the selected event scope when event scope is aggregated.

Manual spot check suggested after merge:
1. Parent linked to two players on one team opens `calendar.html`.
2. Click RSVP on a tracked game/practice with only one child in scope.
3. Confirm the write payload contains only that child id.
