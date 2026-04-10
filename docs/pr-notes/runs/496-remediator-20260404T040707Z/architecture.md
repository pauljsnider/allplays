Decision: make the smallest fix at the conflict-check call site.

Why:
- Lowest blast radius. Only the dereference path is unsafe.
- Preserves the intentional `toDate(null) -> null` change elsewhere in the PR.

Risk surface:
- Calendar import merge logic in `js/edit-schedule-calendar-import.js`.
- No schema, routing, or rendering changes.

Rollback:
- Revert the single guarded check if later review requires a different null-handling policy.
