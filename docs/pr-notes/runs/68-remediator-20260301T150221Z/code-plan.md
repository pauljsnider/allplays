# Code Role Plan (fallback inline)

1. Inspect current `processInvite()` and `redeemAdminInviteAcceptance()` implementation.
2. Patch `accept-invite.html` to include a stronger fallback for `userEmail`.
3. Patch `js/admin-invite.js` to preserve safe write order and fallback email resolution before team write.
4. Run targeted validation commands and commit with focused message.
