# Architecture

Subagent spawning with role-specific agents was unavailable in this runtime, so this note captures the inline architecture analysis.

## Decision
Track whether `syncSharedScheduleCounterpart` created a new counterpart during the current call. Wrap the final `updateDoc(sourceRef, ...)` in a cleanup guard that deletes only that newly created counterpart before rethrowing.

## Risk Surface
- Minimal blast radius: one helper in `js/db.js`.
- Avoids deleting existing counterpart games on update failures.
- Preserves existing caller error handling and source-game rollback semantics.

## Rollback
Revert the `createdCounterpartRef` tracking and guarded final source update block.
