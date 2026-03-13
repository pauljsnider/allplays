Objective: remediate the two unresolved PR #237 review threads without widening scope.

Current state:
- Shared games are projected into `getGames()` with team-facing fields like `opponent` and `isHome`.
- `getGame()` and `subscribeGame()` return raw shared-doc fields for synthetic shared IDs.
- Some schedule and RSVP hydration paths serialize keys as `teamId::gameId` and later parse with `split('::')`.

Required change:
- Preserve team-facing shared-game projections for single-game reads.
- Ensure synthetic shared-game IDs do not contain `::`, and avoid truncating IDs when parsing existing composite keys.

Success criteria:
- Shared game detail/live pages receive `opponent` and `isHome` from `getGame()`.
- Composite key parsing keeps the full shared game ID.
- Changes are limited to the review feedback and validated with targeted tests.
