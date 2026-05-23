# Code Plan

- Add small helpers in `js/volunteer-screening-access.js` to normalize app-written registration text and detect volunteer/staff screening indicators.
- Extend `registrationRequiresVolunteerScreening` with the new app-created registration check while preserving explicit field checks.
- Wrap team registration loading in `js/db.js` with `try/catch`, log the failure, and rethrow.
- Update focused unit tests and run them.
