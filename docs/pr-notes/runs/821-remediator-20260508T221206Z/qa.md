# QA Plan

## Manual Validation
- Load `edit-schedule.html` for an externally linked registration team with schedule snapshot events.
- Simulate `getEvents(currentTeamId)` rejecting during preview generation.
- Confirm the preview failure message is shown and the import button is re-enabled after the catch path.
- Confirm the normal successful preview path still disables the button only when no selectable rows exist.

## Automated Tests
No automated test runner is configured for this static site per `AGENTS.md` and `CLAUDE.md`.
