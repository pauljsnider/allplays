# Code plan — Issue #4932

## Root cause

`runReminderWorkers` awaits each worker directly in a shared consumer loop wrapped by `Promise.all`. Any rejection terminates that consumer and rejects the aggregate call, queued items may not execute, and `failedCount` remains hard-coded to zero.

## Implementation sequence

1. Add all-failure and mixed-result regressions and confirm they fail against the current helper.
2. Catch each worker failure inside the consumer loop and record a normalized indexed outcome.
3. Aggregate deterministic sent and failed counters only after all consumers finish.
4. Run the focused test file and review the diff for scope.

## Edge cases and review checklist

- Rejection counts as failed and never sent.
- Falsy fulfillment counts as examined but neither sent nor failed.
- One rejection cannot terminate a consumer or strand later items.
- Empty input and invalid configuration behavior remain unchanged.
- No fail-fast option, retry behavior, reminder wiring, eligibility change, or page-draining change is introduced.

## Prevention / learning

Bounded worker pools must contain operational failures at the individual work-item boundary. Aggregate-only rejection handling can terminate a lane, strand queued work, and prevent reliable accounting. Recurrence risk is low because focused tests cover the exact failure mode.
