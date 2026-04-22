# QA

## QA Plan
- Run the targeted Vitest file: `tests/unit/parent-dashboard-calendar-day-modal-rsvp.test.js`.
- Confirm the modal renders shared-game RSVP controls before submission.
- Confirm RSVP submission still sends both child IDs and refreshes the open modal state.

## Targeted Regression Risks
- Time-sensitive tests around schedule filtering can silently expire again if they use fixed calendar dates.
- The change should not affect production behavior because only test data moved.

## Minimal Validation Set
- `npx vitest run tests/unit/parent-dashboard-calendar-day-modal-rsvp.test.js`