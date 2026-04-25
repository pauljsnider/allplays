# QA Plan
- Run the failing smoke case directly: `npx playwright test --config=playwright.smoke.config.js tests/smoke/team-schedule-calendar.spec.js --grep "team schedule keeps tracked duplicates and cancelled items out of the wrong filter buckets"` with the local static server on port 4173.
- Confirm the calendar helper can land on the cancelled-event month after switching from all-upcoming to past-events and back from list to calendar view.
- Guardrail checks already covered by the same smoke: upcoming calendar still hides cancelled and duplicate tracked items, and past-events still shows the cancelled event while hiding duplicates.

# Risks
- Main risk is masking a real product bug if the helper reads the wrong UI state. The targeted smoke pass lowers that risk because it verifies the actual rendered month label before navigating.
