# QA Notes

## Failing Checks
- `preview-smoke [preview-smoke]`
- Failing assertions waited on `#schedule-list` to contain imported calendar text, but the list stayed blank.

## Validation Plan
- Run targeted Playwright smoke specs for edit-schedule calendar imports with the smoke config and a local static server.
- Run the full preview smoke command to guard against adjacent mock drift.

## Validation Evidence
- Targeted specs: `SMOKE_BASE_URL=http://127.0.0.1:4173 npx playwright test --config=playwright.smoke.config.js tests/smoke/edit-schedule-calendar-import.spec.js tests/smoke/edit-schedule-calendar-cancelled-import.spec.js --reporter=line`
- Full preview smoke: `SMOKE_BASE_URL=http://127.0.0.1:4173 npx playwright test --config=playwright.smoke.config.js --reporter=line`
