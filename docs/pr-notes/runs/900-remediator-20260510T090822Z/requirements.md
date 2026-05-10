# Requirements

Subagent spawning with role-specific agents was unavailable in this runtime, so this note captures the inline requirements analysis.

## Acceptance Criteria
- If creating a shared schedule counterpart succeeds but the final source-game update fails, the newly created counterpart game is deleted before the error is surfaced.
- The source `addGame` rollback can still delete the source game without leaving an orphaned mirror on the opponent team.
- Existing counterpart updates are not deleted during ordinary update flows, avoiding destructive cleanup of pre-existing schedule links.
- Scope stays limited to `js/db.js` shared schedule rollback behavior.
