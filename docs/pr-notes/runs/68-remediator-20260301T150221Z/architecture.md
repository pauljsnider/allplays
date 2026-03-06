# Architecture Role (fallback inline)

## Current flow
`accept-invite.html` resolves invite and calls `redeemAdminInviteAcceptance()` in `js/admin-invite.js`.

## Risks
- Missing email source leads to hard failure.
- Team doc update can fail unless inviter has role recognized by rules.

## Design decision
- Add resilient email fallback before call.
- In redeem function, grant coach role first, re-read profile for confirmation, then write `teams/{teamId}.adminEmails`.
