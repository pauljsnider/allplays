# Requirements analysis

> The requested `allplays-requirements-expert` skill was unavailable, so this analysis emulates its UX, coach, parent, and sports-manager perspectives.

## Missing behavior

The reminder dispatcher core has no reusable item-level primitive that guarantees a fixed ceiling on simultaneously active workers. This slice adds only that standalone helper; runtime wiring remains out of scope.

## Observable contract

- Accept an item list, a positive-integer concurrency limit, and an async worker.
- Never exceed the configured number of active worker calls and process each item exactly once on a successful run.
- Empty input never invokes the worker and returns `{ examinedCount: 0, sentCount: 0, failedCount: 0 }`.
- For successful execution, `examinedCount` equals the input length, truthy worker results increment `sentCount`, falsey results remain examined but unsent, and `failedCount` remains zero.
- Worker rejections reject the helper because failure-result accounting is out of scope.
- Invalid worker or concurrency configuration fails clearly.

## Scope safeguards

- Do not edit `functions/index.js` or wire the helper into fee reminders.
- Do not change eligibility, queries, page draining, claims, thresholds, delivery, notification content, fixtures, or review-count behavior.
- Preserve the overlap guard with the separate runtime-wiring slice.
