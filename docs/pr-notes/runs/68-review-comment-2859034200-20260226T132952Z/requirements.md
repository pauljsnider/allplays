# Problem Statement
Admin invite acceptance can fail when a signed-in user lacks `users/{uid}.email` and `auth.user.email` is unavailable, causing the flow to throw `Missing user email` before role assignment.

# User Segments Impacted
- Coaches/admins accepting admin invites from emailed links.
- Existing users with legacy or incomplete profiles.
- Program managers relying on invite completion reliability.

# Acceptance Criteria
1. Admin invite acceptance succeeds when profile email is missing but invite code contains `data.email`.
2. Existing behavior remains unchanged when profile email or auth email is present.
3. Parent invite and non-admin invite flows are unaffected.
4. Failure only occurs when all email sources are absent.

# Non-Goals
- Changing Firestore invite schema.
- Refactoring shared auth flows.
- Adding UI copy changes.

# Edge Cases
- Logged-in user with null auth email and null profile email.
- Invite email includes uppercase or surrounding whitespace.
- Invite code invalid/expired (must continue existing failure path).

# Open Questions
- Should `redeemAdminInviteAcceptance` itself own fallback resolution for cross-caller consistency in a future cleanup?
