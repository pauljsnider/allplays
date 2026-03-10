Test strategy:
- Utility regression: assert `getCalendarEventStatus` treats `STATUS:CANCELED`, `STATUS:CANCELLED`, `[CANCELED]`, and `[CANCELLED]` case-insensitively as cancelled.
- Source regression: assert `edit-schedule.html` imports and uses `getCalendarEventStatus` and strips both cancelled prefix spellings before opponent extraction.

Primary regression risks:
- Missing one spelling variant in summary cleanup, leaving ugly titles or wrong opponent parsing.
- Future inline duplication in `edit-schedule.html` drifting from the shared helper again.

Validation plan:
- Run targeted Vitest files first to prove failure/fix quickly.
- Run the broader relevant calendar/edit-schedule unit tests after the fix.

Manual spot check if needed:
- In `edit-schedule.html`, sync an ICS event with `STATUS:CANCELED` or `[cancelled]` prefix and verify the imported card shows Cancelled with no tracking action.
