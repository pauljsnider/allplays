# Architecture Role Summary

## Decision
Implement cleanup inside the existing parent-invite `catch` block in `signup` for tight locality and minimal regression risk.

## Rationale
- Error is detected at the exact point where partial state exists.
- Cleanup logic is adjacent to failure source, avoiding cross-module coupling.
- Preserves existing interface and call graph.

## Controls Equivalence
- Improves control posture by preventing orphaned auth principals.
- Maintains fail-closed semantics by rethrowing original business error.

## Rollback
- Single-block revert in `js/auth.js` restores prior behavior if needed.
