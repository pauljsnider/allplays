## Patch Plan
1. Refactor `redeemAdminInviteAtomicPersistence` write ordering to grant user `coachOf` access before team update.
2. Keep post-grant consistency checks by using a transaction for `team` and `accessCode` writes after user grant.
3. Preserve validation/error behavior for invalid/mismatched/used codes.

## Code Changes Applied
- Updated `js/db.js` `redeemAdminInviteAtomicPersistence`:
- Added preflight reads (`getDoc(teamRef)`, `getDoc(codeRef)`) and validation before any writes.
- Changed first write to `setDoc(userRef, { coachOf, roles, updatedAt }, { merge: true })` so Firestore rules allow subsequent team update.
- Kept a transaction for the final `team` + `accessCode` updates with re-validation against latest code state.
- Preserved normalized email write to `teams/{teamId}.adminEmails` and code usage fields (`used`, `usedBy`, `usedAt`).

## Validation Run
- `pnpm dlx vitest run tests/unit/admin-invite-redemption.test.js`
- Result: pass (`1` file, `4` tests).

## Residual Risks
- If user grant succeeds and final transaction fails (for example, race on code usage), user may retain `coachOf` without code being marked used. This is retry-safe and does not consume the code, but leaves a narrow partial-write edge case.
- Full elimination of this edge case requires privileged server-side redemption or rules that support batched cross-document entitlement bootstrapping.

## Commit Message Draft
Fix admin invite redemption permission ordering
