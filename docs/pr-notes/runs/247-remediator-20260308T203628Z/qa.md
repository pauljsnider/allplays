Validation scope:
- Confirm the RSVP block renders `data-rsvp-container`.
- Confirm `submitCalendarRsvpFromButton` reads the child selector from `[data-rsvp-container]`.
- Confirm `resolveCalendarRsvpSubmission` still returns the same outputs for single-child, selected-child, and invalid-child cases.

Planned checks:
- Use targeted source inspection with `git diff`.
- Run a focused Node command importing `js/calendar-rsvp.js` and exercising the helper with representative inputs.

Residual risk:
- Browser-only integration is not fully exercised in this run because the repository documents manual testing rather than an automated suite.
