# Architecture

The only safe client-side revocation operation currently available to the organizer is revoking the invite/access code they generated. Direct mutation of the invited user's profile and player parent arrays crosses authorization boundaries and is rejected by the existing rules for normal parent organizers.

Decision: keep membership removal as a shell-record state transition, perform access-code revocation first, then mark the family membership removed with `accessStatus: revoked`. Remove the unauthorized profile/player writes from this flow rather than broadening rules in this patch. A future privileged backend workflow can own authoritative profile/player cleanup with admin credentials and audit logging.

## Risks and rollback

- Existing already-linked user profile access may require a backend/admin cleanup path outside this client-only remediation.
- Rollback is limited to reverting `js/family-plan.js`, `firestore.rules`, and the unit test updates.
