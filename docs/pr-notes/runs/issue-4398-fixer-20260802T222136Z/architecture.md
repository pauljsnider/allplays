# Architecture

Bound to starting SHA `98bea9bf5428a41ad056c1c147ba8fddc5a6eb34`.

## Current and proposed state

The backend core currently extracts verified Auth identities, while legacy `js/db.js` performs client-side redemption with editable fallback identity and condition-specific errors. This slice adds only a dependency-injected backend transaction operation that accepts #4397's `{ uid, email, phone }` output.

## Transaction

1. Normalize and validate the eight-character code and the already-verified recipient identity object.
2. Read `accessCodes/{CODE}` and validate type, exact unused markers, active state, future expiry, inviter, non-self redemption, and email-or-phone target match.
3. Derive `friendships/{sortedUidPair}` and read it plus `users/{recipientUid}` before any write.
4. Reject blocked or malformed existing participant state.
5. Create or update the accepted friendship, preserving valid participant orientation and `createdAt`.
6. Update the invite to `used: true`, `usedBy: recipientUid`, and `usedAt: now` in the same transaction.

The friendship preserves the existing contract: accepted status, two members, shared-team intersection, empty `blockedBy`, `source: friend_invite`, invite code, and coherent timestamps. The blast radius is exactly two documents on success and zero on rejection.

## Error and rollback

All validation and transaction failures map to the existing generic error without details. Logs contain only bounded reason enums. Rollback is source reversion because this slice registers no callable and performs no migration or rules change.

## Production-safety review

- Authorization and identity fail closed through #4397's verified claims.
- Partial failure, stale state, and interrupted/replayed attempts are controlled by the single Firestore transaction and unused-state revalidation.
- Privacy is controlled by a generic public error and value-free bounded logs.
- Code and document identifiers are validated before access.
- Confirmation, retention/deletion, browser reload state, rate limits, and collection-size limits are not applicable to this bounded core; later callable registration owns its entry-point controls.
