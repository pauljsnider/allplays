# QA analysis

> The requested `allplays-qa-expert` skill was unavailable, so this analysis emulates its senior QA strategy and regression-guardrail role.

## Focused regressions

Add direct CommonJS-helper tests in `tests/unit/fee-due-reminders-source.test.js`:

1. Use controlled deferred promises with more items than the limit to prove exactly the configured number start while blocked, work is replenished slot by slot, peak activity never exceeds the limit, and all items complete once.
2. Assert empty input never calls the worker and returns the exact zero summary.
3. Assert a known truthy/falsey success sequence produces deterministic examined and sent counters with zero failures.

Avoid timers and completion-order assertions. Do not add rejection accounting tests because failures are explicitly out of scope.

## Focused validation

```bash
npx vitest run tests/unit/fee-due-reminders-source.test.js --reporter=verbose
```

Recurrence risk is low after these tests because the active-worker barrier protects the ceiling and exact summary contract directly.
