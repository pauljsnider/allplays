# Architecture Role Summary

## Decision
Reorder writes within existing helper instead of changing Firestore rules or introducing server-side orchestration.

## Why
- Smallest patch, lowest blast radius.
- Preserves current security model and client architecture.
- Avoids broader rule changes that could alter tenant isolation boundaries.

## Controls Comparison
- Before: first write required pre-existing admin authority and could fail for valid invitees.
- After: first write is owner write to `users/{uid}` (allowed), enabling existing rule path (`isCoachForTeam`) for subsequent team update.
- Net: control equivalence or stronger reliability without broadening write permissions.

## Rollback
Single-function revert in `js/admin-invite.js` if unexpected behavior appears.
