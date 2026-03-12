Test strategy:
- Add a unit test that inspects `calendar.html` and verifies synced ICS events are built through `buildGlobalCalendarIcsEvent(...)` rather than an inline mapping with hard-coded `scheduled` status.
- Re-run the shared ICS event-type suite to confirm cancelled status stays normalized.

Key regressions to watch:
- `STATUS:CANCELLED` and `STATUS:CANCELED` both map to `cancelled`
- TeamSnap `[CANCELED]` and `[CANCELLED]` prefixes remain cancelled
- Global calendar page keeps delegating ICS view-model shaping to the shared helper

Manual spot-check if needed:
- Load a team with a cancelled external event on `calendar.html` and verify the cancelled badge/line-through styling appears in detailed, compact, and day-detail views.
