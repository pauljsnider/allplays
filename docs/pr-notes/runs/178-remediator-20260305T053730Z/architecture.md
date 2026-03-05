# Architecture role notes

Current state:
- Standings loop applies permissive status filter (`if status && status !== completed/final`) allowing missing status rows.
- Tiebreaker comparison receives original `games` input, not filtered standings subset.

Proposed state:
- Introduce a shared `isFinalGameStatus` guard and derive `completedGames` once.
- Build table from `completedGames` and pass `completedGames` into `compareByTiebreaker`.

Risk/blast radius:
- Scoped to native standings calculation logic only.
- Potential behavior shift: legacy status-less games no longer counted (intended by review feedback).
