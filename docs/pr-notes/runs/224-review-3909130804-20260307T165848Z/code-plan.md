# Code Role Summary

Thinking level: medium

## Patch Plan
1. Tighten Firestore rules with helper predicates for incentive docs using `teamId` + `playerId`.
2. Update cap persistence to store `teamId` alongside `playerId`.
3. Rework `calculateEarnings` to cap positive earnings before subtracting penalties.
4. Escape breakdown lines at render time.
5. Add logging and rethrow to `getAggregatedStatsForPlayer`, then catch in `refreshIncentivesPanel` and render a failure message.
6. Extend unit tests for mixed-cap math and escaped panel rendering.

## Conflict Resolution
- Reviewer wording overstates cross-user read risk, but the underlying authorization gap is still valid at the parent-player boundary. Fixing the stricter product control satisfies both the review and the intended privacy model.
