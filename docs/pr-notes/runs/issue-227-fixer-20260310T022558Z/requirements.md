# Requirements Role Notes (Issue #227 Post-game insights)

## Objective
Add post-game team and player insights derived from finalized game stats and play-by-play so users get actionable takeaways instead of only raw tables.

## Current State
- `game.html` shows summary, player stats, play-by-play, opponent stats, and playing time.
- `player.html` shows season/game stats and simple trend charts.
- No dedicated insight artifacts, no role-aware insight views, and no deterministic insight generation from event data.

## Proposed State
- Add a report-level Insights section on `game.html` for finalized games.
- Add a game-specific player insights card on `player.html` when a `gameId` is present.
- Generate insights deterministically from existing aggregated stats, playing-time data, and play-by-play events without introducing a new backend pipeline in this patch.

## Acceptance Mapping
- Team report surfaces offensive, defensive/discipline, momentum, and rotation takeaways.
- Each player with game activity gets a short list of personalized takeaways.
- Player detail page shows the selected game's personalized insight summary.
- Empty-state copy is explicit when finalized games lack enough data for insights.

## Assumptions
- Initial rollout can be basketball-first/generic, based on current tracker event shapes.
- Coach/parent/player access remains the same as the underlying report/player pages.
- Client-side generation is acceptable for this issue's first shippable increment.

## Risk Surface / Blast Radius
- `game.html`
- `player.html`
- New deterministic helper module and tests only

## Recommendation
Ship deterministic client-side insights now to close the feature gap with low blast radius, then add persisted/server-generated artifacts later if usage proves the value.
