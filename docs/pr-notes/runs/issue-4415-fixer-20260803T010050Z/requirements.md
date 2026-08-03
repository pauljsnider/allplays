# Requirements

Evidence baseline: `76ec5df958796c2724be0282a94d09d86e515f38`.

## Root cause

The trusted Firebase Auth identity extractor and atomic redemption transaction exist, but they were never composed at a deployable callable boundary. There is therefore no authenticated server entry point that guarantees only token-derived identities reach the transaction.

## Acceptance invariants

- Export a Firebase callable named `redeemFriendInvite`.
- Reject missing authentication or a caller without a UID and at least one usable verified email or canonical phone claim before the transaction runs.
- Derive recipient identity exclusively from `context.auth.uid` and `context.auth.token`.
- Forward exactly the request code and the Auth-derived recipient identity object.
- Ignore all payload identity fields, profiles, and fallbacks.
- Return the same metadata-free `permission-denied` / `Unable to redeem friend invite.` error for every rejection.
- Return the existing transaction success result unchanged.

## Scope and evidence

No client migration, Rules change, data-model change, or emulator expansion is included. Focused tests must prove authentication, normalized email and phone derivation, malicious payload exclusion, payload-only identity rejection, uniform error mapping without sensitive details, zero transaction calls on precondition failure, and unchanged success output.
