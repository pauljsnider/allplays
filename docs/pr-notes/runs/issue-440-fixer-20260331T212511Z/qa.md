# Issue #440 QA Synthesis

## Primary Regression Targets
- Saved `homeScore` and `awayScore` match trusted score-log totals, not stale manual inputs.
- Finish flow updates the game to completed and invokes live completion status handling.
- Recap email body is built from reconciled totals.
- Double-click during an in-flight save yields one batch commit and one navigation sequence.

## Planned Automated Checks
1. Build a finish workflow harness with mocked inputs, log, Firestore batch, and navigation.
2. Seed `scoreLogIsComplete = true` with a scoring log that conflicts with manual final inputs.
3. Assert:
   - game update uses reconciled totals
   - reconciliation note is inserted into the saved log
   - email body sees reconciled totals
   - completion logic runs
4. Hold the first commit pending, invoke the workflow twice, and assert:
   - second call returns without committing
   - finish button stays disabled during the in-flight save
   - one mailto/redirect sequence runs after resolution

## Residual Risk
- This remains a unit-style harness, not a full browser DOM integration test.
- End-to-end wiring from the actual click listener to `saveAndComplete()` is still covered indirectly by the module call path rather than by browser automation.
