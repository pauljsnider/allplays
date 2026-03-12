Objective: eliminate the hidden Save Team dependency so invited team admins gain team-management access without any extra owner action.

Current state:
- Existing-team admin invites create an access code and update local page state only.
- Dashboard and team-management access rely on `teams/{teamId}.adminEmails`.

Proposed state:
- Sending an admin invite for an existing team persists the invited email onto the team immediately.
- Acceptance/signup flows continue to onboard the user profile, but access no longer depends on a later team save.

Risk surface:
- Grant timing moves earlier, from later save or acceptance to invite-send time.
- Blast radius is limited to the invited email on the targeted team document.

Assumptions:
- Team-admin access is intentionally email-based across the app.
- Persisting the invited email at send time is acceptable because account access is still bound to ownership of that email address.

Recommendation:
- Patch the existing-team invite send path only.
- Add regression coverage that proves the invite path persists team admin access immediately and that the page is wired to use it.
