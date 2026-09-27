# Requirements

**Evidence baseline:** `54bc9505593c74407a05c7c93cb38aca909b70a5`

## Objective

Create a pure server helper that derives usable recipient identities only from trusted Firebase Auth context. No invite reads or writes occur in this slice.

## Required behavior

- Require authenticated `auth.uid` and token context.
- Accept email only when `email_verified === true`; trim, lowercase, and validate it.
- Accept Firebase's trusted `phone_number` claim only when it is canonical E.164.
- Evaluate claims independently. Return all usable verified identities; reject only when none remain.
- Ignore identity values from payloads, profiles, or Firestore.
- Use one generic rejection error for unauthenticated, unverified, missing, and malformed cases.
- Never expose raw claims, invite targets, inviter metadata, or which identity failed.

Firebase does not define a standard `phone_number_verified` boolean. The standard `phone_number` ID-token claim is the verified-provider assertion.

## Test matrix

| Claims | Expected |
| --- | --- |
| Missing auth, UID, or token | Generic rejection |
| Verified mixed-case email | Trimmed lowercase email |
| Unverified or malformed email only | Generic rejection |
| Canonical `phone_number` | Canonical phone |
| Malformed or local-format phone only | Generic rejection |
| Valid email and phone | Both identities |
| Valid email plus malformed phone | Email only |
| Invalid email plus valid phone | Phone only |
| Only payload/profile identities | Generic rejection |
| Any rejected combination | Identical sanitized public error |

## Boundaries

- No invite or friendship operations.
- No transaction, replay, expiration, or blocked-user logic.
- No callable, client, rules, or authentication-provider changes.
- No guessing a country code or repairing malformed phone values.

## Root cause and prevention

There is no reusable backend boundary that converts authenticated Firebase claims into verified normalized recipient identities. Later redemption code should accept identity evidence only from this helper, with regression coverage proving payload and profile values cannot become identity proof.

**Recurrence risk:** Medium until dependent transaction and callable slices adopt the helper.
