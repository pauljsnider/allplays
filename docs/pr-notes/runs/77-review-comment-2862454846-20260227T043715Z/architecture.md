# Architecture Role Output

## Current-State Read
`accept-invite.html` routes admin invites through `redeemAdminInviteAcceptance`, which delegates to `redeemAdminInviteAtomicPersistence` in `js/db.js`. The persistence currently uses Firestore `writeBatch` to update team admin emails, user roles, and invite-code usage.

## Proposed Design
Keep batched atomic commit pattern and harden it with precondition checks and explicit failure wrapping:
- Validate required identifiers and normalized email before writes.
- Verify team doc exists before commit.
- If `codeId` is supplied, verify access code doc exists before commit.
- Commit batch once, with shared timestamp and structured error context.

## Files And Modules Touched
- `js/db.js`

## Data/State Impacts
- No schema changes.
- Write semantics unchanged on success.
- Failure semantics become stricter and explicit before commit.

## Security/Permissions Impacts
- Reduces risk of malformed writes (empty email or invalid code reference).
- Preserves existing RBAC model (`teams.adminEmails`, `users.coachOf`, `users.roles`).

## Failure Modes And Mitigations
- Missing team or code doc: throw before commit, preventing any partial state.
- Firestore transient failure on commit: no writes applied due batch atomicity; wrapped error improves observability.
- Invalid arguments from caller: immediate descriptive error, no write attempt.
