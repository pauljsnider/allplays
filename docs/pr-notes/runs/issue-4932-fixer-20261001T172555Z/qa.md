# QA — Issue #4932

## Regression strategy

- Retain the all-success test for exact examined, sent, and zero-failed counters.
- Add an all-failure test that asserts every index is invoked exactly once and every rejection contributes to `failedCount`.
- Add a mixed test with truthy, falsy, and rejected outcomes settling after different microtask counts; assert every index is attempted and exact aggregate counters are stable.
- Retain concurrency-ceiling and empty-input coverage.

The new failure cases must resolve to summaries rather than reject. Tests avoid sleeps, random delays, wall-clock assertions, and error stack comparisons.

## Focused validation

```bash
npx vitest run tests/unit/fee-due-reminders-source.test.js --reporter=verbose
```

## Guardrails and risk

Contain errors per item, derive counts after all indexed outcomes settle, and keep eligibility and delivery logic outside the helper. Recurrence risk is low after these regressions because they directly cover continuation, exact counters, and the distinction between falsy fulfillment and rejection.
