# Architecture

## Acceptance Criteria
- `edit-schedule.html` must boot successfully under the preview-smoke harness.
- Imported calendar practice rows must render planning context.
- Cancelled imported rows must remain visible while hiding action buttons.

## Architecture Decisions
- Keep production schedule notification code unchanged.
- Update the smoke-test schedule-notification stubs to match the current import surface by exporting `buildScheduleNotificationTargets`.
- Treat this as a harness compatibility fix, not an application behavior change.

## Risks And Rollback
- Blast radius is limited to smoke tests.
- Rollback is a simple revert of the stub export additions if needed.
