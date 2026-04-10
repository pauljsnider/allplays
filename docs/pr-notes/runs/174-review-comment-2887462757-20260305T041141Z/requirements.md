# Requirements Role Summary

Thinking level: medium (behavioral bug in reset/restart flows with moderate regression risk).

## Objective
Ensure "start fresh" behavior does not prompt resume because of stale persisted flags after reset/cancel operations.

## User-facing requirement
- After reset or cancel, tracker should behave as a fresh game start unless new activity occurs.

## Acceptance criteria
1. Reset flow clears persisted signal fields used by resume prompt (`liveHasData`, `liveStatus`) and score/opponent stat artifacts.
2. Cancel flow deletes tracked records (`events`, `aggregatedStats`, `liveEvents`) and clears game-level persisted signal fields.
3. Local in-memory `currentGame` state is aligned with the persisted reset state to avoid stale prompt behavior in same session.
4. No change to preserved linked-opponent identity fields (`opponent`, `opponentTeamId`, `opponentTeamName`, `opponentTeamPhoto`).
