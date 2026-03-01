# Requirements Role (fallback inline)

## Objective
Resolve two unresolved PR #68 review threads for admin invite acceptance flow.

## Required outcomes
1. Prevent `userEmail` from being undefined when redeeming admin invite.
2. Ensure admin invite redemption ordering does not hit Firestore permission denial on team update.

## Scope constraints
- Minimal targeted edits only in affected flow.
- No unrelated refactors.
