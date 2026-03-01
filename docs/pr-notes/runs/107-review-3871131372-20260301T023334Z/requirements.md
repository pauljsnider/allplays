# Requirements Role - PR #107 review 3871131372

## Objective
Prevent parent RSVP submissions from including player IDs outside the selected `teamId + gameId` scope.

## Decision
Treat client-provided `childId/childIds` as untrusted input and intersect against known schedule participants for the selected game before submission.

## Risk Surface / Blast Radius
- Current blast radius (before): Any caller able to invoke `window.submitGameRsvp` could tamper IDs and skew per-player attendance totals across families on the same team.
- Proposed blast radius (after): RSVP writes are restricted to players already represented by schedule rows in the selected game context.

## Assumptions
- Parent dashboard has `allScheduleEvents` populated for the viewed game context.
- RSVP intent for child-specific row should not expand to siblings unless explicitly and validly included.

## Acceptance Criteria
- Explicit `childId` is accepted only if it belongs to selected game scope.
- Explicit `childIds` are deduplicated and filtered to selected game scope.
- Invalid explicit IDs are dropped (fail-closed).
- Fallback behavior still uses selected game scope only.
