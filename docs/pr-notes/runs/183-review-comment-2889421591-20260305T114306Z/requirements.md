# Requirements role summary

Thinking level: medium (behavioral regression with bracket state transitions)

## Objective
Prevent BYE auto-advance from completing rounds whose empty slot depends on unresolved upstream results.

## Current state
- One-sided games can auto-complete when one slot has a team and the other is empty.
- Previous guard only blocked `sourceType: winner`, leaving policy too permissive for future source types.

## Proposed state
- Auto-advance only when empty slot is a true BYE seed slot (`sourceType: seed`, no team assigned).
- Keep unresolved dependency slots (`winner`, and any non-seed dependency types) pending.

## Acceptance criteria
- 3-team bracket creation: `R1G1` auto-completes by BYE, `R2G1` remains pending.
- After reporting `R1G2`, `R2G1` must be `scheduled`, not `completed`, and `winnerTeamId` remains null.
