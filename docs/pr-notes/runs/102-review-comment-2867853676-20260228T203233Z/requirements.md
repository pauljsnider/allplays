# Requirements Role Summary

## Objective
Ensure access-code expiration treats numeric zero (`expiresAt: 0`) as a valid timestamp and blocks redemption/validation as expired.

## User impact
- Coaches/admins: expired invites cannot be reused.
- Parents: receive correct "Code has expired" outcome for invalid invite links.

## Acceptance criteria
- `expiresAt` null/undefined remains non-expiring.
- Numeric timestamps, including `0`, are evaluated as real expiration values.
- `validateAccessCode` and `redeemParentInvite` produce consistent expiration decisions.
