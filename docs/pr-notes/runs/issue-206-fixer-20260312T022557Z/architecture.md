Objective: reduce stale UI exposure after a successful cancel write without expanding blast radius.

Current state:
- `cancelScheduledGame(...)` already separates fatal cancellation errors from non-fatal chat notification errors.
- The page handler calls `loadSchedule()` but does not await it before warning the user about notification failure.

Proposed state:
- The cancel button handler awaits `loadSchedule()` whenever `cancelScheduledGame(...)` returns `cancelled: true`.

Why this path:
- Smallest viable patch.
- Preserves the existing helper split, Firestore writes, and user messaging.
- Directly addresses the stale-UI portion of the bug report.

Controls and blast radius:
- No new writes.
- No rollback semantics added or removed.
- No broadened permissions.

Tradeoff:
- The warning alert appears slightly later because the UI refresh completes first.
- That delay is acceptable because it aligns the visible schedule state with the already-committed cancellation.

Rollback:
- Revert the one-line await in `edit-schedule.html`.
