# QA analysis

**Bound SHA:** `54bc9505593c74407a05c7c93cb38aca909b70a5`

## Failing invariant

Friend invite ownership must derive exclusively from authenticated, verified Firebase Auth claims. No server-side extraction boundary currently exists, allowing later redemption code to trust editable profile, fallback, or client-provided identity data.

## Regression matrix

Use table-driven `node:test` coverage for:

- Verified, mixed-case email normalization.
- Valid canonical Firebase phone identity.
- Both verified claims together.
- Unverified email, including missing or non-boolean verification.
- Blank, malformed, non-string, or whitespace-containing email claims.
- Blank, non-E.164, punctuated, local-format, or non-string phone claims.
- Missing auth, UID, token, or any usable identity.
- Mixed valid and invalid claims that return only the trusted identity.

Every rejected case must assert the identical code and message, absent sensitive details, and no email, phone, invite code, target marker, inviter metadata, or raw token content in the serialized error.

## Focused validation

`node --test functions/test/friend-invite-redemption.test.cjs`

## Residual recurrence risk

**Medium.** The helper creates a safe identity primitive, but direct client redemption remains until dependent transaction, callable, rules, and client-cutover work adopts it.
