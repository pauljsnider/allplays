# Architecture

## Decision
Keep the filtering in `js/officiating-utils.js`, where conflict detection is centralized, instead of filtering only at the `edit-schedule.html` call site.

## Rationale
- `edit-schedule.html` passes `Object.values(gamesCache)`, which can include cancelled games.
- Centralizing the status guard prevents the same false-positive behavior for any future caller of `getOfficiatingAssignmentConflictWarnings`.
- The patch is scoped to the conflict detection path and does not change scheduling data or persistence.

## Risks And Rollback
- Risk is low: cancelled games are removed from warning calculations only.
- Rollback is reverting the helper guard and related unit assertions.
