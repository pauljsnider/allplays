# QA Notes

Risk: edit schedule page boot fails before `loadSchedule()`, so `#schedule-list` stays blank and imported calendar rows never render. Stale smoke stubs can mask calendar behavior.

Target validation:

```bash
npx playwright test tests/smoke/edit-schedule-calendar-import.spec.js tests/smoke/edit-schedule-calendar-cancelled-import.spec.js --config=playwright.smoke.config.js
npx vitest run tests/unit/edit-schedule-calendar-import.test.js
```

Behavior to preserve:
- Imported future game/practice rows render.
- Cancelled imported rows stay visible and show cancelled state.
- Cancelled imported rows do not show Track or Plan Practice actions.
- Tracked UID and DB time-conflict imports remain suppressed.
