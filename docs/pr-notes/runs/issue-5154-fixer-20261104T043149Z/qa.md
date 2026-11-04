# QA Analysis — Issue #5154

## Regression strategy

Extend `tests/unit/live-tracker-period-buttons.test.js`, the nearest existing regression file, with an executable test of the production `setPeriod()` function extracted from `js/live-tracker.js`. A small `new Function(...)` factory injects state, DOM, persistence, synchronization, broadcast, event-builder, and render dependencies without exporting page-local implementation details or booting Firebase.

### Paused transition

Given Q1, `state.running = false`, and an active live session, changing to Q2 must:

- update `state.period`;
- log the transition;
- persist local tracker state explicitly;
- synchronize the game document;
- broadcast a `period_change` event containing Q2;
- render the header.

This fails before the fix because the paused path suppresses log/broadcast and never invokes explicit persistence or game-document synchronization.

### Same-period no-op

Calling `setPeriod()` with the current value must not log, synchronize, or broadcast. Header rendering may still occur.

## Focused validation

```bash
npx vitest run tests/unit/live-tracker-period-buttons.test.js --reporter=verbose
```

A new Playwright test is unnecessary for this page-local handler change because the executable unit regression covers the exact paused branch, persistence/sync calls, emitted payload, and duplicate-selection behavior.

## Prevention / learning

Stopped-clock transitions need explicit coverage. Running-clock-only tests miss the documented end-of-period workflow.

## Recurrence risk

**Medium** — duplicated state channels make partial updates easy to reintroduce; the regression couples all three channels.
