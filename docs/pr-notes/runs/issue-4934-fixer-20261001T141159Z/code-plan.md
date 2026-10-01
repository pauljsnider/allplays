# Code plan

## Minimal patch

1. Add `maxRuntimeMs` and `getCurrentTimeMs = Date.now` to `drainOrderedPages`.
2. Validate the runtime cap with `requirePositiveInteger` and the clock as a function.
3. Capture the starting time once and check elapsed time before each new `loadPage`.
4. Return the accumulated summary with `stoppedBecause: 'maxRuntimeMs'` when the guard prevents more page work.
5. Pass the explicit runtime cap in existing tests and add the deterministic exact-boundary regression.

## Pitfalls

- Checking after `loadPage` starts one extra page.
- Checking inside `processPage` creates ambiguous partial-page accounting.
- Using `>` misses exact-deadline stopping.
- Overriding page-cap results when the page bound itself ended iteration weakens stop-reason reporting.

No change belongs in `fee-due-reminders-source.test.js`; the nearest behavioral harness directly imports this helper.
