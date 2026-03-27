## Objective

Add automated coverage for Game Day entry routing so coaches land on the correct `game-day.html?teamId={teamId}&gameId={gameId}` target when the incoming URL is missing, stale, or points at a non-game event.

## Current State

- `game-day.html` owns game selection and URL normalization inline.
- Existing automated coverage does not exercise the entry-routing heuristic.
- A stale `requestedGameId` is accepted before the selector evaluates live or upcoming games.

## Proposed State

- Extract the entry-selection logic into a unit-testable helper.
- Add focused automated tests for live-game preference, stale-requested-id fallback, and URL normalization.
- Keep page behavior otherwise unchanged.

## Risk Surface

- Blast radius is limited to Game Day entry selection and browser URL normalization.
- Wrong selection can misroute coaches into the wrong matchup during active play.
- No tenant or PHI surface changes.

## Assumptions

- A requested game is invalid for Game Day auto-entry if it is cancelled, completed, or stale past the three-hour cutoff.
- Explicit direct links to valid scheduled future games should continue to work.

## Recommendation

Use a small shared helper module plus unit tests. This gives CI-friendly coverage with minimal page churn and keeps the control surface limited to the routing heuristic called by `initPage()`.
