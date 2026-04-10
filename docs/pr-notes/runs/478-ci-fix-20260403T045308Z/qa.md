Root cause hypothesis: the smoke test fails because the cancelled calendar practice row is filtered out before render, not because the badge text is wrong.

Evidence:
- The failing locator cannot find any row containing `Team Practice`.
- `mergeCalendarImportEvents()` marks the imported cancelled practice as `isPractice: true`.
- `loadSchedule()` filters out all practice rows when `showPractices` is false unless the view is `upcoming-practices`.

Validation scope:
- Run the failing Playwright smoke spec only.
- Confirm the cancelled practice row is present, shows `Cancelled`, and still hides `Plan Practice`.

Residual risk: this does not validate unrelated schedule filters or parent/team pages.
