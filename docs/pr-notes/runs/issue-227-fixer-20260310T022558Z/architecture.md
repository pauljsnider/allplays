# Architecture Role Notes (Issue #227 Post-game insights)

## Objective
Introduce post-game insights without changing Firestore schema or adding new backend execution paths in this fix lane.

## Current Architecture
- Game reports read the game doc, `aggregatedStats`, and `events` directly from Firestore in-page.
- Player detail pages fan out across games and events client-side.
- No persisted insight objects exist under games or players.

## Proposed Architecture
- Add `js/post-game-insights.js` as a pure helper module.
- Feed it:
  - game metadata
  - roster
  - per-player aggregated stats
  - playing-time map
  - ordered play-by-play events
- Return structured team insights plus per-player insights for rendering in `game.html` and `player.html`.

## Control Equivalence
- No new write paths.
- No broader reads than the pages already perform.
- Tenant isolation remains scoped to the same team/game/player documents already loaded today.

## Blast Radius Comparison
- Before: report pages expose only raw stats and summaries.
- After: same source data, plus deterministic interpretation rendered in the client.

## Rollback Plan
- Remove the new helper import and insights UI blocks from `game.html` and `player.html`.
- Delete `js/post-game-insights.js` and its tests.

## Constraint Note
The requested orchestration skills/subagents are not available in this execution context, so these notes are an inline synthesis standing in for role artifacts.
