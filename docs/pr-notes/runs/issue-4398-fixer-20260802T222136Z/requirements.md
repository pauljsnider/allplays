# Requirements

Bound to starting SHA `98bea9bf5428a41ad056c1c147ba8fddc5a6eb34`.

## Objective

Add a server-side Firestore transaction core that consumes the verified recipient identities from #4397, validates one active friend invite, creates or updates the accepted friendship, and consumes the invite atomically.

## Acceptance mapping

- A normalized stored email or complete international phone must match the corresponding verified identity. Request payload and profile identity are never trusted.
- The invite must exist at its normalized code, be a `friend_invite`, be unused, have a future expiry, identify a different valid inviter, and not be revoked, inactive, or terminal.
- The friendship ID is the sorted inviter and recipient UID pair. Existing blocked, nonempty-`blockedBy`, or participant-inconsistent records reject without repair.
- Every authoritative read and validation precedes both writes. Success writes only the friendship and invite consumption in one transaction.
- Replay, concurrency loss, identity mismatch, self-redemption, expiration, use, inactivity, and blocked friendship commit zero writes.
- All failures expose only `permission-denied` / `Unable to redeem friend invite.` with no details or sensitive values.

## Scope

No callable registration, emulator integration, client migration, Firestore Rules change, or friendship schema redesign. Optional absent `active` and `status` remain compatible with current invite creation.

## Root cause and prevention

The missing control is a server-side transactional boundary connecting trusted Firebase Auth identity to mutable invite and friendship state. Future identity-targeted redemption must derive identity from trusted claims, validate authoritative state inside one transaction, stage writes only after every validation passes, and cover zero-write rejection plus replay.
