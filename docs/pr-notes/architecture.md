# Architecture Role Notes (League Link + Standings)

## Objective
Add external league standings visibility without changing existing schedule ingestion or local scoring system behavior.

## Current Architecture
- Team metadata is managed in `edit-team.html` and persisted by existing Firestore team write paths.
- Team page computes season record from local game data only.
- External schedule ingestion uses ICS parsing (`fetchAndParseCalendar`) and does not parse standings.

## Decision
Introduce a separate league standings module (`js/league-standings.js`) and keep it orthogonal to ICS schedule ingestion.

## Controls and Blast Radius
- Current blast radius: local record visibility only.
- New blast radius: read-only outbound fetch to league URL + proxy fallback attempts for standings parsing.
- Control equivalence: no broadened team data access, no new write permissions, no schema migration requirement.

## Tradeoffs
1. Parse TeamSideline HTML directly (selected): immediate value with no backend service.
2. Build server-side adapter: more stable parsing but adds infra/toil.
3. Manual standings entry: low technical risk but high coach toil and stale data risk.

## Rollback Plan
- Remove standings card render in `team.html`.
- Remove `leagueUrl` field usage in `edit-team.html`.
- Revert `js/league-standings.js` and associated tests.
