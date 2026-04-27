# Requirements

## Acceptance Criteria
- Undo Last for a volleyball point restores the exact prior home score, away score, and serving team.
- Volleyball UI updates immediately after undo: main score, volleyball panel score, serving indicator, and game log.
- Volleyball undo must not remove a log row unless rollback data is present and usable.
- Home point, away point, ace, and service error undo paths all preserve rally scoring and side-out behavior.
- Repeated volleyball undos move backward newest-to-oldest without negative scores or serve corruption.
- Non-volleyball stat undo behavior remains unchanged.

## User Impact
- Coach/stat keeper can correct a bad tap under game pressure.
- Parent/live viewer receives corrected score state instead of stale scoreboard data.
- Program manager gets consistent tracker behavior across sports.
