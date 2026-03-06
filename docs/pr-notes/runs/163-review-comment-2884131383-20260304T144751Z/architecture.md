# Architecture Role Summary

## Decision
Keep recurrence logic in `expandRecurrence` unchanged (already includes pre-window count accounting), and strengthen verification through a regression test.

## Rationale
- Lowest-risk path: avoid touching stable recurrence arithmetic unless behavior is still wrong.
- Existing logic already computes pre-window `generated` via `precountCursor` before enforcing `count` in main loop.
- A targeted regression test reduces future regression risk without expanding blast radius.

## Controls
- No schema/data migrations.
- No API contract changes.
- Deterministic fake-time test guards correctness across long-running historical series.
