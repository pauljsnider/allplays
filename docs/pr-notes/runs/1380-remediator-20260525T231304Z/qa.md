# QA Plan

Automated validation:
- `npx vitest run tests/unit/calendar-day-modal-rsvp.test.js --reporter=verbose`
- `npx vitest run tests/unit/team-schedule-filter.test.js --reporter=verbose`

Regression coverage:
- Add/keep a UTC+ local-midnight default print options assertion so `2026-05-25` remains `2026-05-25` rather than `2026-05-24`.
