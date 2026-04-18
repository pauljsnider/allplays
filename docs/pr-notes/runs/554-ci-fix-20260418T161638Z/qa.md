# QA

## QA Plan
Validate the shared-game parent dashboard modal still renders grouped child RSVP controls and stays open with refreshed summary data after submission.

## Targeted Tests
- `npx vitest run tests/unit/parent-dashboard-calendar-day-modal-rsvp.test.js tests/unit/parent-dashboard-rsvp-controls.test.js`
- `npm test -- --run tests/unit/parent-dashboard-calendar-day-modal-rsvp.test.js`

## Regression Risks
- Modal fallback could surface day-matching events that the schedule list currently filters out by time window.
- Selected-player filtering must remain intact when the fallback path runs.
