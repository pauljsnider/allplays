# QA

## Risk Assessment
- Primary risk: PR #597 breaks existing edit-schedule imported calendar flows.
- Most likely cause: fixture drift, because the failing specs mock older module imports.

## Regression Targets
1. Imported practice rows render with planning context.
2. Cancelled imported rows remain visible and actionless.
3. Tournament standings override helpers do not break schedule boot.

## Validation Matrix
- Unit: tournament standings helpers.
- Unit: edit-schedule tournament wiring.
- Smoke intent: preview-smoke edit-schedule calendar import and cancelled import specs.

## Manual Checks
- Open `edit-schedule.html#teamId=<team>`.
- Confirm imported practice rows still show Calendar, Practice, title, location, and Plan Practice.
- Confirm cancelled imported rows still show Cancelled and hide Track/Plan Practice actions.
- Confirm tournament standings admin panel still appears only for full-access admins when pool results exist.