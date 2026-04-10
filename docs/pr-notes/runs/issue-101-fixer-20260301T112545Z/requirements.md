# Requirements Role Output

## Objective
Ensure parent-invite email/password signup never reports success when invite linking fails and rollback removed the auth account.

## User-Facing Requirement
- If parent invite linking fails at any point, signup must fail visibly on `login.html` with an error and remain on the signup form.
- `verify-pending.html` redirect must only occur when signup truly succeeded.

## Acceptance Criteria
1. `signup(email, password, activationCode)` rejects when `validation.type === 'parent_invite'` and invite linking/profile creation fails.
2. Caller catch path is triggered, so no success redirect is executed.
3. Existing successful parent-invite signup path remains unchanged.

## Risk/Blast Radius
- Scope is isolated to parent-invite branch in `js/auth.js` signup flow.
- No schema changes; no changes to non-parent activation code flows.
