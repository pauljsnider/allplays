Decision: centralize global-calendar ICS event shaping in a small utility function instead of leaving the mapping inline in `calendar.html`.

Why:
- The calendar page needs a testable seam for `type` and `status` normalization.
- Reusing existing helpers (`getCalendarEventType`, `getCalendarEventStatus`) keeps behavior aligned and avoids a second cancellation parser.

Current state:
- `calendar.html` loads parsed ICS events and converts them into calendar view models inline.

Proposed state:
- `js/utils.js` exports a helper that converts one parsed ICS event into the global-calendar event object.
- `calendar.html` calls that helper and skips invalid dates.

Controls:
- No new network calls.
- No schema changes.
- Existing cancelled rendering paths remain unchanged.
