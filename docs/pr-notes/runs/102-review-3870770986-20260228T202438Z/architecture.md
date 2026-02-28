# Architecture Role - PR #102 Review 3870770986

## Current state
`isAccessCodeExpired` normalized `expiresAt` to milliseconds but used strict `>` comparison.

## Proposed state
Use `>=` comparison to enforce expiration at the exact configured instant.

## Risk surface and blast radius
- Blast radius is low and localized to expiration boundary handling.
- Affected flows are only those consuming `isAccessCodeExpired` (parent invite redemption checks).
- No schema, API, or dependency changes.

## Controls
- Fail-closed at boundary time.
- Existing normalization logic remains intact for Timestamp-like, Date, and numeric input.

## Rollback
- Revert the comparison operator and associated tests if product intent changes.
