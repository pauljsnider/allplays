# Requirements role notes

## Acceptance Criteria
- Missing `revokedAt` on an otherwise active entitlement must not reject access.
- Malformed explicit `revokedAt` remains invalid and must not unlock access.
- Team entitlements only unlock for the requested current season; old season docs such as `2025_team-pass` must not unlock later seasons.
- Parent users must not be allowed to read raw team entitlement docs containing Stripe/customer/payment/purchaser metadata.

## Edge Cases
- Expired or malformed expiry fields still reject.
- Wrong team id and wrong tier still reject.
- Account entitlement behavior remains unchanged except for missing revokedAt handling.
