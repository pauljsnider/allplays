# Architecture

Evidence baseline: `5a5e93495c208fcd5d8a234f824cb6b0e8bb14ad`.

## Current and proposed state

Current: #4415 is present. `functions/index.js` registers `redeemFriendInvite`, and the callable delegates Auth-derived identity plus the invite code to the transaction factory. Tests currently model Firestore in memory.

Proposed: extend `functions/test/friend-invite-redemption.test.cjs` with emulator-backed callable-path cases using the production handler and transaction factory. Seed through Admin Firestore, invoke with verified Auth claims, and read both documents authoritatively.

## Invariants

- All transaction reads precede friendship and invite writes.
- One Firestore transaction creates or updates the accepted friendship and consumes the invite.
- The replay transaction re-reads the consumed invite, rejects generically, and performs no writes.
- Full document data and update times remain unchanged after replay.

## Safety and blast radius

- Authorization, atomicity, replay/idempotency, stale-state revalidation, and privacy are applicable and covered.
- Existing injected transaction-failure coverage remains the rollback proof.
- Confirmation, retention/deletion, size limits, and browser interruption are not applicable to this server-side test slice.
- Blast radius is low: test and CI-command wiring only. No production schema, callable contract, Rules, or client changes.

## Recommendation

Add isolated verified-email and verified-phone emulator cases and run them inside the repository's existing Firestore emulator CI command. Do not change production code unless the emulator exposes a real incompatibility.
