# Code Role Artifact

## Implementation Plan
1. Update `getTournamentPoolLabel` in `js/tournament-brackets.js` to accept tournament context and use tournament-level division as a fallback.
2. Pass tournament context through pool-seed resolution so advancement can resolve `Division • Pool` standings into slots that only store plain pool names.
3. Use the same contextual label in seed collection, saved standings index construction, and advancement preview rows.
4. Add a focused unit regression for division-scoped pool advancement and cross-division isolation.

## Conflict Resolution
- Requirements wanted missing division to fail safely, while architecture required legacy unscoped pools to keep working. Chosen path: use division context when present, otherwise preserve existing unscoped behavior.
- Code and QA both flagged that fixing only `collectTournamentPoolSeeds` is incomplete. Chosen path: also patch `getPoolSeedTeamName` and preview label context.

## Risks And Rollback
- Risk: preview labels may change from `Pool A #1` to `10U Gold • Pool A #1` when division context exists. This is intentional and aligns preview with standings scope.
- Rollback: revert `js/tournament-brackets.js` and the unit test addition.

## Commit Message
Fix division-scoped tournament advancement
