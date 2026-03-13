# Architecture role summary

Thinking level: medium (state machine correctness)

## Decision
Constrain BYE auto-advance by source semantics, not by exclusion list.

## Current vs proposed
- Current: allow auto-completion for any one-sided game except explicit winner-source empty slot.
- Proposed: allow auto-completion only when empty slot is a seed BYE.

## Blast radius
- File scope: `js/bracket-management.js` only for behavior change.
- No data model, API, Firestore rule, or UI contract change.

## Risk and rollback
- Risk: under-advancing if seed semantics are malformed.
- Rollback: revert this commit; behavior returns to previous broad auto-advance logic.
