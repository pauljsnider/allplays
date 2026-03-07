# Requirements Role Summary

Thinking level: medium

## Objective
Keep parent incentives truthful when one or more aggregated stat reads fail during earnings calculation.

## Current State
- `getAggregatedStatsForPlayer` already logs and rethrows Firestore read failures.
- `refreshIncentivesPanel` batches all game stat reads with `Promise.all`, so one rejected read collapses the entire panel load.
- Schedule-chip cache entries can remain stale if a game stat read fails after a prior successful load.

## Proposed State
- Preserve the helper's throw-on-failure contract.
- Degrade gracefully at the panel layer by isolating per-game stat failures, excluding those games from totals, and surfacing a warning to the parent.
- Clear cache entries for failed or missing stat payloads so the UI does not imply zero earnings or stale success.

## Acceptance Criteria
- A Firestore failure on one game does not block viewing rules and earnings for other games.
- The panel explicitly warns that some games were excluded from the calculation.
- Existing helper behavior still logs context and rethrows an actionable error.
