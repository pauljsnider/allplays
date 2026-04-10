# Requirements Role Notes

- Scope: address PR #482 review thread `PRRT_kwDOQe-T5854qRhi` only.
- Requirement: block stat tracker config deletion when any team-owned game or participating shared-game document still references the config.
- Evidence: `getGames(teamId)` already merges `teams/{teamId}/games` with `collectionGroup(db, 'sharedGames')` results for the same team, so the delete guard must cover both sources to avoid dangling `statTrackerConfigId` references.
- Assumption: only shared games involving the team being edited should block deletion for that team's config.
