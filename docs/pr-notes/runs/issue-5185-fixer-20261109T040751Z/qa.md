# QA analysis

## Regression strategy

Extend `tests/unit/live-tracker-integrity.test.js` with a live-tracker-specific wiring assertion. The test must prove that:

- the live tracker imports projected queue validation;
- pending queue entries use `canApplyQueuedSubstitution` rather than only the current lineup;
- `applyQueue()` calls `canApplySubstitutionQueue` before `saveHistory()` and before iterating through pairs.

The existing behavioral helper tests already prove that reusing an incoming player makes a projected queue invalid. The new integration assertion connects that behavior to the affected runtime.

## Focused validation

Run only `npx vitest run tests/unit/live-tracker-integrity.test.js --reporter=verbose`, first before implementation to confirm the new assertion fails, then after implementation to confirm it passes.
