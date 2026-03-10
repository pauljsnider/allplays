Regression target:
- A cancelled ICS event mapped into the global calendar must have `status: 'cancelled'`.

Test strategy:
- Add a unit test for the global-calendar ICS mapping helper.
- Cover both status normalization and the event-shaping fields the calendar relies on.
- Run `npm test -- tests/unit/calendar-ics-event-type.test.js` and then the full unit suite.

Manual spot check if needed:
1. Sync an ICS event with `STATUS:CANCELLED` or `[CANCELED]`.
2. Open `calendar.html`.
3. Confirm the event renders with cancelled treatment instead of as an active event.
