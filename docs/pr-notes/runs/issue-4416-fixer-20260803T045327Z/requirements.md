# Requirements Analysis

Evidence baseline: `5a5e93495c208fcd5d8a234f824cb6b0e8bb14ad`.

## Objective

Add focused Firebase emulator coverage proving authenticated friend invite redemption commits friendship creation and invite consumption atomically, then rejects replay without mutating either record.

## Acceptance mapping

- Verified email: invoke the callable handler with `email_verified: true` and a matching normalized email; assert success and the expected friendship ID.
- Verified phone: invoke the callable handler with a canonical Firebase `phone_number` and a matching stored phone; assert the same success state.
- Atomic success: after the callable resolves, read the accepted friendship and consumed invite from the emulator and assert both use the same redemption timestamp.
- Replay protection: call the same invite again and assert only `permission-denied`, `Unable to redeem friend invite.`, and no details.
- Replay immutability: compare the complete friendship and invite data plus document update times before and after replay.

## Root cause / missing behavior

Dependency #4415 added the production callable and transaction. Existing coverage uses an in-memory Firestore double, which cannot detect integration drift in Admin Firestore references, snapshots, timestamps, transaction semantics, or replay behavior. This is a coverage gap, not an identified production logic defect.

## Assumptions and scope

- Auth claims, never payload identity fields, remain the trusted caller identity.
- Email and phone fixtures are isolated and cleaned up deterministically.
- Existing in-memory edge-case and rollback tests remain in place.
- Identity mismatch, self-redemption, expiration, prior-use variants, blocked friendships, registration, client migration, and Rules changes remain out of scope.

## Success criteria

The focused emulator command passes for email and phone redemption, proves both authoritative documents commit together, and proves replay returns the generic public error with byte-for-byte-equivalent state afterward.
