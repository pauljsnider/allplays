# Requirements

## Acceptance Criteria
- If registration schedule preview conflict loading fails, the import action button is not left permanently disabled.
- Admins can recover from a transient `getEvents(currentTeamId)` failure without reloading the page.
- The change is limited to the registration schedule import preview error path for PR review thread `PRRT_kwDOQe-T586AthvG`.

## Assumptions
- No broader import flow redesign is requested.
- Existing successful preview/import behavior must remain unchanged.
