Objective: ensure accepted admin invites result in usable team-management access for the invited coach across supported onboarding paths.

Current state:
- Existing invite acceptance logic already treats `teams/{teamId}.adminEmails` as the canonical team-management grant.
- Google signup/admin-invite onboarding can swallow invite redemption failures and continue as if access was granted.

Proposed state:
- Admin invite redemption failures during Google onboarding fail closed, clean up the new auth user, and do not leave a false-success dashboard redirect.
- Best-effort profile decoration after a successful redemption remains non-blocking.

Risk surface:
- Affects only new-user Google admin invite onboarding and redirect handling.
- Blast radius is limited to `js/auth.js` and related invite/auth tests.

Recommendation:
- Preserve `adminEmails` as the control source of truth.
- Patch Google admin invite signup to match the fail-closed behavior already used for parent invites and email/password admin invite signup.
