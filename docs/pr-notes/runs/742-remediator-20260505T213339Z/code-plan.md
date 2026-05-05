# Code Plan

Subagent note: role-specific sessions_spawn was unavailable, so this is inline code-role analysis.

## Implementation Plan
1. Add `matchesRegistrationReviewStatus` helper for explicit filter cases and use it from `listTeamRegistrationReviews`.
2. Add an explicit `rosterDestinationType` parameter to `buildRegistrationRosterDecision` and pass it from `approveTeamRegistration` based on whether a selected player existed before approval.
3. Remove existing guardian `/users/{id}` writes from the team-admin approval batch to avoid Firestore permission rollback.
4. Split registration Firestore rule read/update/delete statements while preserving `isTeamOwnerOrAdmin(teamId)` authorization.
5. Add focused unit coverage for filter semantics and new-player audit classification.
