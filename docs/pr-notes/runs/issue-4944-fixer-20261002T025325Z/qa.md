# QA analysis

## Deterministic regression matrix

| Case | Expected behavior |
| --- | --- |
| Slow first load | One load, no processing, one attempted page, fetched docs examined, zero sent/failed, `maxRuntimeMs`, initial cursor preserved. |
| Slow later load | Two loads, one processing call, load-level counters include both pages, outcome counters and cursor reflect only page one. |
| Exact deadline | A load returning at exactly the limit is not processed because the comparison is `>=`. |
| Under budget | Processing starts normally; its completed outcome and cursor are retained even if the callback itself reaches the deadline. |

Retain existing coverage for pre-load exhaustion, `maxPages`, successful multi-page draining, short-page draining, and completed counter aggregation.

## Failing-before proof

Add the regressions first and run the focused dispatcher suite against the dependency head. The exhausted-load tests must fail because the current helper calls `processPage` and advances resumable state. Confirm the affected function is unchanged from referenced base `0a47cdd9b9a59c1580af237611768c99628a0104`.

## Focused validation

```bash
npx vitest run tests/unit/pre-event-reminder-dispatcher.test.js tests/unit/fee-due-reminders-source.test.js --reporter=verbose
```

The fee-reminder suite protects the adjacent worker helper exported by the same core module. No browser, native, or broad smoke validation is warranted.

## Prevention

Budgeted async pipelines need a deadline check after every awaited phase and before the next side-effect phase. Resume state must be committed only after the corresponding processing stage succeeds.
