# QA notes

Affected checks are the preview smoke tests for edit schedule calendar imports and season record fields. The expected validation is `npm run test:smoke -- tests/smoke/edit-schedule-calendar-import.spec.js tests/smoke/edit-schedule-calendar-cancelled-import.spec.js --reporter=line` or equivalent Playwright invocation.

Local smoke execution is blocked in this workspace because the Playwright Chromium executable is not installed under `.cache/ms-playwright`. Validation completed: static stub export/version check passed, and `npm run test:unit -- tests/unit/schedule-notifications.test.js tests/unit/edit-schedule-notifications.test.js` completed with 240 files / 1202 tests passing due the repo's Vitest script including the full unit suite.
