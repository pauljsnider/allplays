# Architecture — Issue #4932

## Current behavior

`runReminderWorkers` snapshots inputs, starts at most `min(concurrency, items.length)` consumers, and assigns each index exactly once. Fulfilled truthy results mean sent; fulfilled falsy results mean examined but not sent. A rejection currently escapes its consumer loop and the outer `Promise.all`, losing the summary and potentially leaving queued items unclaimed.

## Minimal design

Catch errors around each individual `await worker(...)`, record an indexed normalized outcome such as `{ sent, failed }`, and continue that consumer loop. After every consumer settles, derive `sentCount` and `failedCount` from the indexed outcomes. Validation failures remain fail-fast because they are configuration errors, not worker outcomes.

## Compatibility and scope

Preserve the worker signature, fixed concurrency, index assignment, empty-input result, truthiness semantics, and summary shape. Do not expose error objects, add retries or logging, change eligibility or delivery, or wire the helper into the production reminder flow.

## Risk

The main risk is semantic ambiguity between a fulfilled falsy result and a rejected result. Explicit normalized outcomes and focused tests make those states mutually exclusive. Recurrence risk is low because the helper is isolated and not yet wired into reminder delivery.
