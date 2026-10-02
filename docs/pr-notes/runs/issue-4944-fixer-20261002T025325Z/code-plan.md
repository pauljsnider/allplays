# Code plan

## Minimal patch

1. Document `drainOrderedPages` load-level counters, processing-level outcomes/cursor, and the cooperative runtime bound.
2. Keep the existing pre-load budget guard.
3. After `loadPage` returns and load-level counters are recorded, recheck the budget before `processPage`.
4. Return `maxRuntimeMs` immediately on post-load exhaustion.
5. Move `lastCursor = nextCursor` until after successful page processing so fetched-but-unprocessed pages never advance resume state.

The requirements and code roles proposed excluding blocked-page documents from `examinedCount`; architecture and QA proposed preserving its existing fetched-document meaning. The implementation follows the latter because the helper already records `examinedCount` before processing and the issue requires explicit semantics without requesting a metric redefinition.

## Tests

Add deterministic regressions for slow first load, slow later load, exact deadline, and successful under-budget processing. Assert exact load/process call counts and the full summary contract.

## Validation

Run the dispatcher regressions first to capture failure before the fix, then rerun the dispatcher and fee-reminder suites after implementation.

## Pitfalls

- Checking after `processPage` still admits late side effects.
- Using `>` admits work at the exact deadline.
- Advancing `lastCursor` before processing can skip unprocessed records on resume.
- Describing the cap as a hard timeout would be inaccurate because already-started callbacks cannot be interrupted.
