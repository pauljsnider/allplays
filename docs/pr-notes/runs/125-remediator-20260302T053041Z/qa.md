# QA role (manual fallback)

- Update unit expectations in `tests/unit/parent-dashboard-rsvp.test.js` for ambiguous/invalid scope to assert throws.
- Run targeted vitest suite for parent dashboard RSVP scope resolution.
- Regression check: single-child and explicit valid child scope still return expected IDs.
