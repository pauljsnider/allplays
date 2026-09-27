# Requirements Analysis

## Objective

Complete the Firestore emulator rejection matrix for authenticated friend-invite redemption. Prove every required rejection returns the same privacy-safe public error and commits zero changes to invite or friendship state.

## Current gap

- Emulator coverage exists for successful email and phone redemption plus replay protection.
- In-memory transaction tests cover identity mismatch, self-redemption, expiration, prior use, and blocked friendships.
- Callable unit coverage proves payload identities are ignored.
- Missing evidence is callable-level emulator coverage with authoritative before/after Firestore snapshots for the full rejection matrix.

## Required cases

| Case | Fixture | Required invariant |
|---|---|---|
| Identity mismatch | Active invite targeted to an identity absent from verified Auth claims | Generic rejection; invite unchanged; no friendship created |
| Payload identity | Auth mismatches while request payload supplies the target UID/email/phone | Payload cannot authorize; same zero-write result |
| Self-redemption | Inviter UID equals authenticated recipient UID | Generic rejection before friendship mutation |
| Expiration | `expiresAt` is before request time | Invite remains unused; no friendship created |
| Prior use | Invite is already used with an existing friendship | Neither document changes |
| Blocked friendship | Existing canonical friendship is blocked | Blocked state remains byte-for-byte unchanged |

Every case must invoke the callable so Auth identity derivation and public error sanitization are covered together.

## Public error contract

Every rejection exposes only `permission-denied`, `Unable to redeem friend invite.`, and no details. Serialized errors must omit invite code, stored targets, inviter UID/name, authenticated or payload recipient metadata, and internal rejection reasons.

## Zero-write contract

Snapshot each relevant document as existence, normalized data, and update time immediately before and after the request. An absent friendship must remain absent. An existing friendship must retain identical data and update time. Cleanup occurs only after assertions.

## Boundaries and assumptions

- In scope: `functions/test/friend-invite-redemption.test.cjs`; core changes only if the emulator reveals a defect.
- Out of scope: successful redemption/replay, client migration, Rules changes, and friendship redesign.
- Dependencies #4415 and #4416 are present at `4941b01c546e2125f96561b26faed69b8498d565`.
- Verified Firebase Auth claims remain the only recipient authorization source.
