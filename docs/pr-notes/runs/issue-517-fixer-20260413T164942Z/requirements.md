# Requirements

## Acceptance Criteria
1. Team Management existing-team admin invites normalize the entered email, persist invited admin access, and show outcome-specific feedback.
2. Existing-user and email-fallback invite outcomes expose a shareable admin code/link from Team Management.
3. Admin invite redemption through `accept-invite.html` shows a success message with the team name and redirects to `dashboard.html`.
4. Signed-out handoff preserves the 8-character code and `type=admin` through login and back into invite redemption.
5. Duplicate auth callbacks do not redeem the same admin invite twice.
6. Parent invite behavior remains unchanged.

## Edge Cases
- Mixed-case or whitespace email input.
- Duplicate admin email entry.
- Existing-user admin invites with immediate access persistence.
- Email-delivery fallback that still needs a valid shareable code/link.
- Missing, expired, or already-used codes.
- Logged-in direct redemption versus logged-out login handoff.

## Non-Goals
- Reworking Firebase transaction logic.
- Broad refactors of invite/auth architecture.
- Expanding into unrelated invite flows.
- Email template verification.

## Open Questions Resolved
- Scope stays on the existing-team Team Management path from `edit-team.html`.
- Success is proven by the Team Management fallback UI, admin redemption success copy, and redirect to `dashboard.html`.
