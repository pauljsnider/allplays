# Architecture role notes

Current state:
- Admin invite flow mutates team-level admin access (`teams/{teamId}.adminEmails`) and user-level coach access (`users/{userId}.coachOf`, `roles`).

Proposed state:
- Keep two-write sequence explicit: team update first (when needed), then user profile update.
- Preserve existing `coachOf` memberships by append+dedupe.

Risk surface:
- Team/user write ordering and role escalation logic.
- Blast radius limited to `js/accept-invite-flow.js` admin invite branch.
