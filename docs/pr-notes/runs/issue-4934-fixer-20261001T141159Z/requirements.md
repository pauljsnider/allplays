# Requirements analysis

## Missing behavior / root cause

`drainOrderedPages` is bounded only by `maxPages`. Slow page loading or processing can therefore continue until the page cap even after the intended runtime budget has elapsed. This is a follow-on gap from #4933, not a reminder eligibility or delivery defect.

## Behavioral contract

- Accept a positive-integer `maxRuntimeMs` alongside `pageSize` and `maxPages`.
- Measure elapsed time from helper entry and check it before starting each page.
- Stop when elapsed time is greater than or equal to the runtime budget.
- Finish and count a page already started, then avoid loading or processing another page.
- Report runtime stopping as `maxRuntimeMs` and page-cap stopping as `maxPages`.
- Preserve all completed-page counters and `lastCursor`; an unstarted page changes neither.
- Keep short or cursorless pages `drained`, retain fail-fast callback errors, and preserve ordered single-page execution.

## Scope guardrails

Do not wire the helper into fee reminders or change eligibility, thresholds, claims, notification content, delivery, page ordering, cursor semantics, or execution concurrency.

## Acceptance scenarios

Use a deterministic clock to allow one full page, reach the exact deadline during its processing, and prove that no second page begins while the completed page's counters and cursor remain intact. Retain the existing page-cap regression to prove distinct stopping reasons.
