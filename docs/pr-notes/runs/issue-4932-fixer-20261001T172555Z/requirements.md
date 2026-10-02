# Requirements — Issue #4932

## Behavioral contract

- `runReminderWorkers` uses non-fail-fast execution: one rejected item is isolated and every remaining input is still offered to the worker.
- The resolved summary deterministically reports total inputs as `examinedCount`, truthy fulfilled results as `sentCount`, and thrown or rejected calls as `failedCount`.
- Falsy fulfilled results remain examined but count as neither sent nor failed.
- Invalid concurrency or a missing worker still fail before work begins.
- Failure accounting must not retry delivery, change worker arguments, or alter reminder eligibility or delivery behavior.

## Acceptance mapping

- Mixed-outcome coverage must assert that every input index is invoked despite rejection.
- Exact counters must remain independent of completion order or concurrency interleaving.
- Existing all-success coverage remains, with focused all-failure and mixed-result regressions added.

## Scope and stakeholder impact

Changes stay inside the worker helper and its adjacent unit tests. They do not wire the helper into `sendFeeUnpaidDueReminders`, change thresholds, claims, content, page draining, or fixtures. Recipients see no eligibility or content change; managers benefit because one failed task no longer blocks unrelated tasks, and operators receive stable failure accounting.

## Root-cause framing and risks

The worker loop directly awaits each call inside `Promise.all`, so a rejection terminates that queue consumer, rejects the aggregate, and prevents per-item failure accounting. Catching failures at the individual item boundary fixes that defect. Falsy fulfilled results must not be reclassified as failures, and tests must assert attempted indexes as well as counters.
