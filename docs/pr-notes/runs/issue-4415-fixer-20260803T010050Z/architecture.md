# Architecture

Evidence baseline: `76ec5df958796c2724be0282a94d09d86e515f38`.

## Current and proposed state

Current: the hardened extractor and transaction live in `functions/friend-invite-redemption-core.cjs`, but `functions/index.js` does not import or register them.

Proposed: add a small dependency-injected callable handler beside the core. It reads only `data.code`, derives `{ uid, email, phone }` from `context.auth`, and calls the existing transaction with exactly those values. Register it as the Gen 1 `redeemFriendInvite` callable.

## Trust boundary and blast radius

Trusted inputs are `context.auth.uid`, verified `context.auth.token.email`, and canonical `context.auth.token.phone_number`. Payload identities, Firestore profile identities, and fallback identities never cross the boundary. Success retains the existing atomic friendship and invite writes. Rejection writes nothing and reveals no invite target, inviter, stored identity, or internal reason.

Admin SDK writes bypass Rules, so every lifecycle and friendship invariant remains in the transaction core. Direct client redemption remains a residual risk explicitly deferred to later migration work. Rollback removes only the adapter and export; no data rollback is required.
