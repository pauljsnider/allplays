# Code Plan

Plan baseline: branch `paulbot/fix/issue-4415-20260803010048`, HEAD/base `76ec5df958796c2724be0282a94d09d86e515f38`, clean worktree.

## Minimal patch

1. Extend `functions/test/friend-invite-redemption.test.cjs` first with a transaction spy covering authentication, trusted identity derivation, malicious payload exclusion, generic error mapping, and unchanged success results.
2. Add `createFriendInviteRedemptionCallableHandler` to `functions/friend-invite-redemption-core.cjs`. The factory validates dependencies, extracts identities through the existing helper, forwards exactly `{ code, recipientIdentities }`, and maps every thrown value to a fresh metadata-free public error.
3. Import the factory and transaction creator in `functions/index.js`, instantiate them with the existing Firestore, Timestamp, HttpsError, and logger dependencies, and register `exports.redeemFriendInvite = functions.https.onCall(handler)`.
4. Run the focused Node test and inspect the final merge-base diff for authorization, privacy, atomicity, and scope.

Non-goals: client migration, Firestore Rules changes, data-model changes, cache-bust changes, broad suites, deploy, push, or PR creation.
