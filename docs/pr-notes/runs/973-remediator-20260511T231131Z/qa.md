# QA Plan

- Static inspection: verify `createVenueAvailability`, `createOrganizationBlackout`, and `createVenueBlackout` no longer spread caller-provided objects into Firestore writes.
- Static inspection: verify venue-control submit handlers check access state before calling create functions.
- Manual browser plan if exercised: open `organization-schedule.html#teamId=<team>` as full-access user and confirm saving availability and blackouts still works; open with missing/unauthorized/single-team state and confirm controls are inactive and no write is attempted.

No automated test runner is defined for this static site.
