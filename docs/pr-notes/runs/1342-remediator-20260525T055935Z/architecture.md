# Architecture

## Decision
Keep `deriveResumeClockState` responsible for visible running-clock restoration, and add a small pure helper that derives the elapsed lineup time separately.

## Rationale
The clock and lineup stat totals have different sources of authority on same-device resume. The persisted game document is authoritative for clock continuity, while the local tracker snapshot is authoritative for player stat time already accumulated on that browser.

## Implementation shape
- `deriveResumeClockState` exposes the persisted clock update timestamp and evaluation timestamp.
- `buildResumeLineupElapsedMs` returns full elapsed time when no local snapshot exists.
- When a local snapshot exists, it returns only elapsed time after the local snapshot `savedAt`; invalid local timestamps return zero to avoid double-counting.
