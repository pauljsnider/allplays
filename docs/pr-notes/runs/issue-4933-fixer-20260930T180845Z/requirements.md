# Requirements analysis

## Missing behavior

The existing reminder drain fixes page size at 50, exposes only raw callback results, and mixes pagination with runtime-limit behavior. The reusable slice needs an explicit page size, a deterministic page-result cursor, a page cap, and standard examined/sent/failed counters without changing fee-reminder delivery behavior.

## Contract

- The first load receives a null cursor and the configured page size.
- Each later load receives the preceding page's explicit cursor.
- A short or cursorless page is drained; consuming the configured number of full, continuing pages is page-cap stopping.
- Examined counts loaded documents. Sent and failed aggregate explicit processing outcomes; skipped work may be examined without being sent or failed.
- Loader and processor errors remain fail-fast.

## Scope guardrails

Do not wire the helper into fee reminders or change eligibility, claiming, content, delivery, concurrency, or runtime-limit policy.
