# QA Notes

## QA Plan
- Reproduce targeted preview-smoke failures for edit schedule calendar imports.
- Validate both affected smoke specs after adding the missing DB stub export.

## Validation Evidence
- `npx playwright test tests/smoke/edit-schedule-calendar-import.spec.js --config=playwright.smoke.config.js --reporter=list` passed: 2/2.
- With local static server on port 4173, `npx playwright test tests/smoke/edit-schedule-calendar-import.spec.js tests/smoke/edit-schedule-calendar-cancelled-import.spec.js --config=playwright.smoke.config.js --reporter=list` passed: 3/3.

## Coverage
- Imported practice row renders Calendar, Practice, Plan Practice, title, and location.
- Cancelled imported game/practice rows remain visible and hide Track/Plan actions.
