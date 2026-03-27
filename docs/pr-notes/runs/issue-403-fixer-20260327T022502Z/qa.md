Test strategy:
- Add a unit-style module harness for `calendar.html`.
- Cover one day containing both a DB-backed game and an ICS-only event.
- Assert only the DB-backed event exposes RSVP buttons.
- Submit `maybe` and verify payload, selected button state, updated summary, and modal visibility.

Why this is sufficient:
- It exercises the exact stale-state branch in `submitCalendarRsvp`.
- It proves mixed-event rendering still behaves correctly after the refresh.

Residual risk:
- This is not a browser-driven Playwright test, so DOM behavior is validated through the page module’s rendered HTML rather than a real browser engine.
