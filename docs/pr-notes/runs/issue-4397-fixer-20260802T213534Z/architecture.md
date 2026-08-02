# Architecture

## Evidence and SHA binding

- Reviewed the repository and adjacent invite code at `54bc9505593c74407a05c7c93cb38aca909b70a5`.
- The proposed core and test files do not exist at this baseline.
- Current friend redemption is client-side and may use profile or fallback email. Replacing that path is outside this slice.
- Adjacent Functions cores are CommonJS, export pure helpers, inject `HttpsError`, and use `node:test`.

## Proposed helper

Add `extractVerifiedFriendInviteRecipientIdentities(auth, HttpsError)` in `functions/friend-invite-redemption-core.cjs`. It returns `{ uid, email, phone }`, with empty strings for unavailable optional identities.

The helper inspects only callable `context.auth` data. It does not accept request data, invite documents, Firestore profiles, Admin Auth lookups, or caller-provided fallbacks.

## Claim contract

- Require a nonblank `auth.uid` and token.
- Email comes only from `auth.token.email`, requires `email_verified === true`, and is trimmed, lowercased, and validated with the repository-standard email shape.
- Phone comes only from Firebase's standard `auth.token.phone_number` claim and must already be canonical E.164: `+` followed by 8 to 15 digits with a nonzero first digit.
- Do not require a nonstandard phone verification boolean or the current sign-in provider. Firebase's standard phone claim represents the verified linked phone identity.
- Do not strip phone punctuation or infer country codes.
- Invalid or unverified claims are excluded independently. Reject when no usable verified identity remains.

## Error and safety contract

Every rejection throws the same `permission-denied` error and message without details. Do not echo claim values, invite targets, inviter metadata, or which claim failed.

Authorization and privacy fail closed before protected data is read or mutated. Atomicity, idempotency, persistence, partial failure, retention, and interrupted-browser recovery are not applicable because this slice has no side effects. Rollback is a source-only revert.

## Minimal scope and validation

- `functions/friend-invite-redemption-core.cjs`
- `functions/test/friend-invite-redemption.test.cjs`

Focused command: `node --test functions/test/friend-invite-redemption.test.cjs`.
