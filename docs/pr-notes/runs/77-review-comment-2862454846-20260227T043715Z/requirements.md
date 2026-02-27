# Requirements Role Output

## Problem Statement
Admin-invite redemption must never leave coach/admin authorization in a partially applied state; either all related writes succeed together or no permission-bearing write is applied.

## User Segments Impacted
- Coach/admin invitees: must receive complete role assignment immediately after acceptance.
- Existing team staff: must not see orphan admin emails without matching user roles.
- Parents/players: indirect impact through stable role-based authorization checks.
- Program admins: need predictable auditability when invite acceptance fails.

## Acceptance Criteria
1. Admin invite persistence performs team admin-email update, user coach-role update, and access-code consumption as one atomic write operation.
2. If any required input is invalid (missing teamId, userId, or resolvable user email), no write is committed.
3. If an invite code id is provided but no corresponding access-code document exists, no write is committed.
4. Failures from persistence surface as explicit errors that can be logged and shown as invite-processing failure.
5. Successful redemption continues redirect behavior unchanged for invitees.

## Non-Goals
- Redesigning parent invite flow.
- Changing Firestore security rules.
- Introducing backend Cloud Functions.

## Edge Cases
- Invite acceptance retries after transient network failure.
- Invite code deleted/expired between validation and commit.
- User document missing before redemption (must still be creatable via merge semantics).
- Mixed-case email inputs.

## Open Questions
- Should admin invite redemption support Google-signup flow directly in `js/auth.js` when code type is `admin_invite`?
