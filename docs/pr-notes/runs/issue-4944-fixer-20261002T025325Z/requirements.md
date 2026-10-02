# Requirements analysis

## Root cause and impact

`drainOrderedPages` checks elapsed time before `loadPage`, but an awaited load can consume the remaining budget. The helper then starts `processPage`, advances resumable state, and may report `drained` even though the deadline was already exhausted.

This can initiate reminder side effects outside the intended execution window and make operational telemetry claim that fetched work was completed.

## Behavioral contract

- Keep the pre-load runtime check and recheck immediately after every awaited load, before `processPage` starts.
- Treat elapsed time equal to the configured limit as exhausted.
- Add `sentCount` and `failedCount` only from completed `processPage` calls.
- Advance `lastCursor` only after the fetched page is successfully processed; preserve `initialCursor` or the prior completed page cursor otherwise.
- Keep ordinary draining, page-cap behavior, pre-load exhaustion, callback errors, and completed-work counters unchanged.

The requirements role recommended treating `examinedCount` as processing-level work and excluding a fetched-but-blocked page. Architecture and QA instead treated it as the existing load-level metric. The main-run synthesis preserves that established meaning: `pagesAttempted` counts returned loads and `examinedCount` counts their fetched documents, while outcome counters and `lastCursor` remain processing-level state. This avoids an unrelated metric redefinition and makes the distinction explicit in tests and documentation.

## Runtime bound

The limit is a cooperative admission bound, not cancellation. An already-started `loadPage` or `processPage` callback cannot be forcibly interrupted and may finish after the deadline. The helper prevents a new processing callback from starting once exhaustion is observed.

## Acceptance scenarios

Cover a slow first load, a slow later load after one completed page, an exact-deadline load, and successful under-budget processing with deterministic clocks and exact call/counter/cursor assertions.

## Recurrence risk

Medium before coverage: async waits create separate admission boundaries, and conflating a fetched cursor with a completed cursor can silently skip work.
