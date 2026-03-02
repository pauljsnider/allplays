# Architecture Role Synthesis

## Decision
Move admin invite redemption from page-local logic into `js/db.js` as a reusable function that performs Firestore writes.

## Why
- Keeps Firestore mutation logic centralized and testable.
- Avoids duplicated invite semantics in page scripts.
- Preserves existing access model (`adminEmails` array checks in dashboard and team pages).

## Minimal Change Plan
1. Add `redeemAdminInvite(userId, code)` in `js/db.js`.
2. Function flow:
   - Query unused code by normalized code.
   - Verify `type === 'admin_invite'`.
   - Load team; fail if missing.
   - Resolve user email from profile and append to `adminEmails` using `arrayUnion`.
   - Update user profile with `coachOf: arrayUnion(teamId)` and `roles: arrayUnion('coach')`.
   - Mark access code used (`used`, `usedBy`, `usedAt`).
3. Replace inline admin branch in `accept-invite.html` with helper call.

## Control Equivalence
- Authorization path remains unchanged (still `adminEmails` in team doc).
- New writes improve auditability by persisting server-side state expected by rules/UI.

## Rollback
Revert commit; behavior returns to current known-bug state with no schema changes.
