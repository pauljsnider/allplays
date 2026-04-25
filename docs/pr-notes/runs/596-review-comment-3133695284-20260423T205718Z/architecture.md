# Architecture

## Current State
`buildPoolGame` swaps `homeTeam` and `awayTeam` for away games, but it previously passed through raw scores unchanged. Because the source game object is team-centric, that created venue-mismatched standings rows.

## Proposed Change
Normalize score orientation inside `buildPoolGame` by deriving `teamScore` and `opponentScore` once, then mapping them to `homeScore` and `awayScore` based on `isHome`.

## Blast Radius
Low. The change is isolated to tournament pool standings row construction in `js/tournament-standings.js`.

## Controls
- No schema changes.
- No Firebase or persisted data changes.
- Regression coverage added at the unit level.

## Risks
If score semantics differ from the rest of the app, this would invert away results incorrectly. Current `season-record.js` and `shared-schedule-sync.js` behavior supports the team-centric score assumption.
