# Architecture analysis

## Root cause

The runtime guard occurs only at the top of the loop. `loadPage` is awaited, so it can cross the deadline before control returns. The current implementation then invokes `processPage` and assigns `lastCursor` without another admission check.

## Minimal design

1. Preserve the existing pre-load `>= maxRuntimeMs` guard.
2. Await and normalize the page.
3. Record load-level observability (`pagesAttempted` and fetched-document `examinedCount`).
4. Apply the same elapsed-time guard before processing side effects.
5. On exhaustion, return `maxRuntimeMs` without invoking `processPage` or changing `lastCursor`.
6. Otherwise process normally and commit `lastCursor` only after processing completes.

## Invariants

- `pagesAttempted` counts page loads that returned successfully.
- `examinedCount` counts documents fetched by those page loads.
- `sentCount` and `failedCount` count completed processing outcomes.
- `lastCursor` is the resume point after the last successfully processed page, never after a merely fetched page.
- Callback exceptions remain fail-fast.
- A callback admitted under budget may complete after the deadline; the next guard prevents additional work.

## Scope

Do not change `drainDueReminderPages`, `runReminderWorkers`, production wiring, reminder eligibility, notification behavior, quotas, or concurrency. `drainOrderedPages` currently has no production caller, so the exported contract and direct regression suite are the relevant boundary.

## Recurrence risk

Low after deterministic boundary and cursor regressions; the remaining overrun possibility is the documented inability to cancel already-started callbacks.
