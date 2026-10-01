# Architecture analysis

## Decision

Extend `drainOrderedPages` additively with required `maxRuntimeMs` and an optional test clock, `getCurrentTimeMs = Date.now`. Validate both inputs, capture the start once, and guard at the top of every page iteration before `loadPage`.

The stopping precedence remains:

1. A terminal short or cursorless completed page is `drained`.
2. Exhausting `maxPages` is `maxPages`.
3. Reaching the runtime limit before another otherwise-eligible page is `maxRuntimeMs`.

## Compatibility

The helper has no production consumer yet, so requiring an explicit runtime budget is low-risk and prevents future unbounded callers. Do not change `drainDueReminderPages`, `functions/index.js`, callback contracts, counters, cursors, or error propagation.

## Recurrence risk

Low. Exact call-count and summary assertions guard against moving the check after page loading, partially processing a page, or obscuring page-cap versus runtime-cap results.
