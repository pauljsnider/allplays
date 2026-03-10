Current state:
- `edit-schedule.html` duplicates cancellation detection instead of using shared utility logic.
- `js/utils.js#getCalendarEventStatus` already supports both `CANCELED` and `CANCELLED` plus summary prefixes.

Proposed state:
- Import `getCalendarEventStatus` into `edit-schedule.html`.
- Use helper output to derive `isCancelled`.
- Expand summary prefix cleanup regex to strip both `[CANCELED]` and `[CANCELLED]` case-insensitively before opponent extraction.

Tradeoffs:
- Reusing the helper removes drift and reduces future toil.
- Keeping the change local to the calendar import path minimizes regression risk versus broader refactoring.

Controls:
- No data model changes.
- No auth or Firestore behavior changes.
- Blast radius is limited to imported calendar card normalization.

Rollback:
- Revert the helper import and the two cancellation-related lines in `edit-schedule.html`.
