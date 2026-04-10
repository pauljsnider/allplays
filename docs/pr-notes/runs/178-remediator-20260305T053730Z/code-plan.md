# Code role notes

Implementation plan:
1. Add `isFinalGameStatus(game)` helper near other utilities.
2. In `computeNativeStandings`, create `completedGames = games.filter(isFinalGameStatus)`.
3. Replace standings loop input from `games` to `completedGames` and remove inline permissive status check.
4. Pass `completedGames` to `compareByTiebreaker`.
5. Add two focused unit tests for missing-status exclusion and head-to-head filtering.
6. Execute targeted unit test file.
