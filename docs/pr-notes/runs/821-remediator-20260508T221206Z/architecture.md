# Architecture

## Decision
Keep the fix local to `renderRegistrationScheduleImport` in `edit-schedule.html`.

## Rationale
The failure is caused by UI state set before an awaited Firestore read and not restored in the `catch` path. Restoring `button.disabled` in that catch keeps the blast radius small and does not change data writes, Firestore access, or import planning.

## Risk And Rollback
Risk is low: a transient preview error now leaves the UI actionable instead of locked. Rollback is a single-line removal if needed.
