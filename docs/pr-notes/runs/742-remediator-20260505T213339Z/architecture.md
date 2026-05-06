# Architecture

Subagent note: role-specific sessions_spawn was unavailable, so this is inline architecture analysis.

## Decisions
- Keep status filtering in `js/registration-review.js` as a pure helper and call it from `listTeamRegistrationReviews` so dropdown/status semantics are centralized.
- Pass explicit `rosterDestinationType` into `buildRegistrationRosterDecision` from `approveTeamRegistration`; generated ids alone are not enough to infer existing-vs-new player intent.
- Remove client-side `/users/{guardianId}` writes from the approval batch. This keeps approval atomic for the roster player and registration decision while respecting existing Firestore user-doc ownership rules.
- Split registration rules into explicit read/update/delete clauses, each using `isTeamOwnerOrAdmin(teamId)`, to make least-privilege intent unambiguous.

## Risks And Rollback
- Existing guardian profile denormalization is no longer performed in this approval batch. Rollback is to restore those writes only after adding a server-side/admin path or narrowly provable rules.
