# Code plan

Smallest fix:
1. Update `buildGetAllEvents()` in `tests/unit/team-schedule-events.test.js` to include a default `canManageTeamAvailability: () => false` dependency.
2. Destructure `canManageTeamAvailability` inside the generated function scope before evaluating the extracted `getAllEvents()` body.
3. Do not change unrelated production schedule logic.
