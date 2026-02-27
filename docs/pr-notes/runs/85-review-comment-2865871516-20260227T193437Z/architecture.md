# Architecture Role Summary

## Current state
`edit-team.html` inline admin invite flow called `sendInviteEmail` directly with `result.code` from `inviteAdmin`.

## Proposed state
Normalize `result.code` to a trimmed string and gate all outbound email + code display behavior behind non-empty code checks.

## Risk and blast radius
- Blast radius limited to admin invite UI flow in `edit-team.html`.
- Firestore writes and invite generation remain in `inviteAdmin`; no schema or backend rule changes.
- Failure mode shifts from potential invalid-email invocation to deterministic warning UX.

## Control comparison
- Control equivalence improved: explicit precondition validation before side effect (`sendInviteEmail`).
