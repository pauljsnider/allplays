Objective: add a self-serve parent membership request flow without requiring an invite code.

Current state:
- Parent onboarding is invite-code only from `parent-dashboard.html`, `accept-invite.html`, and `js/db.js`.
- Coaches/admins can invite parents from `edit-roster.html`, but there is no pending request queue.

Proposed state:
- Signed-in parents can submit a request against a public team/player from `parent-dashboard.html`.
- Full team managers can review pending requests from roster management and approve or deny them.
- Approval grants the same parent linkage semantics used by invite redemption: `users.parentOf`, `users.parentTeamIds`, `users.parentPlayerKeys`, and `roles: ['parent']`.

Risk surface and blast radius:
- Firestore writes expand to `teams/{teamId}/membershipRequests/{requestId}` plus parent-link writes already used by invite redemption.
- UI blast radius is limited to `parent-dashboard.html` and `edit-roster.html`.
- Security risk is controlled by keeping create rights with the requester and approval rights with team owner/admin only.

Assumptions:
- Parent users are already authenticated before requesting access.
- Teams and non-sensitive player docs remain publicly readable, consistent with current browse/search behavior.
- Minimal viable denial UX is a visible denied status plus ability to resubmit.

Recommendation:
- Add a team-scoped `membershipRequests` subcollection keyed by `requesterUserId__playerId`.
- Keep request payload small, auditable, and denormalized enough for roster review UI.
- Reuse the existing parent-link data shape so downstream reads and rules continue to work.

Success criteria:
- Parent can submit a request without a code.
- Coach/admin can approve or deny from roster management.
- Approval makes the player/team appear in the parent dashboard without any invite redemption step.
- Focused unit tests cover helper behavior and page/rules wiring.
