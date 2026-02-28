# Requirements Role Output

## Problem Statement
Access codes must become invalid at the exact expiration timestamp to prevent boundary-time redemption.

## User Segments Impacted
- Coach/admin generating and validating invites/codes
- Parents redeeming invite codes near expiration
- Team admins relying on predictable expiration behavior

## Acceptance Criteria
1. Access code validation returns expired when `nowMs` equals `expiresAtMs`.
2. Access code validation continues to return valid when `nowMs` is before `expiresAtMs`.
3. Access code validation continues to return expired when `nowMs` is after `expiresAtMs`.
4. Behavior remains unchanged for used and invalid codes.

## Non-Goals
- Changing code generation behavior or expiration duration logic
- Refactoring access-code validation architecture

## Edge Cases
- Firestore `Timestamp` values converted via `toMillis()`
- Numeric millisecond expiration values
- Missing `expiresAt` stays non-expired by current design

## Open Questions
- None for this review-comment scope.
