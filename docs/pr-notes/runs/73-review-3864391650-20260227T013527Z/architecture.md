# Architecture Role Summary

- Current state: `finalizeParentInviteSignup` has two sequential writes (`redeemParentInvite`, `updateUserProfile`) plus auth rollback only.
- Failure mode: second write fails after first commits, producing split-brain state (`accessCodes.used=true` without viable auth user).
- Proposed state:
  - Track redemption completion in `finalizeParentInviteSignup`.
  - Add `rollbackInviteRedemptionFn(userId, inviteCode)` compensation hook invoked only if redemption step succeeded.
  - Keep auth rollback as second compensation step.
- Control/Blast-radius note:
  - Blast radius reduced from persistent consumed invite + dangling links to bounded failed-attempt rollback for the same user/code.
  - Guard condition prevents rollback if code was not redeemed by the same user.
