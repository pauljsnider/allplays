# Architecture Role - PR #107 review 3871131372

## Current State
`resolveRsvpPlayerIdsForSubmission` returns explicit `childId/childIds` without validating membership in selected `teamId + gameId` participant set.

## Proposed State
Build canonical allowed participant IDs from `allScheduleEvents` filtered by `teamId` and `gameId`, then sanitize explicit IDs through this set.

## Controls Equivalence
- Access control remains Firebase-rule enforced.
- Data integrity control is strengthened client-side by constraining writable RSVP payload composition.

## Design Notes
- Reuse existing `uniqNonEmpty` and `parseChildIds` normalization.
- Add `sanitizeToAllowedScope(ids)` to centralize filtering.
- Keep resolver deterministic and side-effect free for simple testability.

## Rollback
Revert `js/parent-dashboard-rsvp.js` and import version bump in `parent-dashboard.html`.
