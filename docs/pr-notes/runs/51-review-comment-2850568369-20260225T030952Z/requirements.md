# Requirements Role (allplays-requirements-expert)

## Objective
Ensure `game-day.html` auto-selects the next actionable game, not a just-finished game, when coaches open without `gameId`.

## Current vs Proposed
- Current: scheduled-future selection accepts non-cancelled games within a 3-hour cutoff, including completed games.
- Proposed: scheduled-future selection excludes games marked completed via either `status` or `liveStatus`.

## Risk Surface / Blast Radius
- Surface: default game resolution only.
- Blast radius: limited to `pickBestGameId`; no change to explicit `gameId` links, no data writes.

## Assumptions
- Completed games can retain start times within 3 hours and should not be treated as upcoming.
- Live games must still win priority.

## Success Criteria
- If one game is completed and another is upcoming, auto-pick selects upcoming.
- Completed game remains reachable via explicit URL/game history flows.
