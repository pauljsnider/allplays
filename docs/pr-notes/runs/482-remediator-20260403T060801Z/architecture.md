# Architecture Role Notes

- Current state: `deleteConfig(teamId, configId)` queries only `teams/{teamId}/games`.
- Proposed state: retain the team-games query and add a shared-games existence check using the same participation selectors as `getSharedGamesForTeam`.
- Blast radius: limited to config deletion validation in `js/db.js`; no data model or UI changes.
- Control goal: prevent deleting a config while any shared schedule or tournament game still points at that config.
