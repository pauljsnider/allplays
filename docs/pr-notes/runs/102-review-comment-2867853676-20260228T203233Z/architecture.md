# Architecture Role Summary

## Current state
- Expiration decisions were partially centralized in `isAccessCodeExpired`.
- `validateAccessCode` still had inline falsy-gated logic (`if (data.expiresAt)`) that can skip numeric `0`.

## Proposed state
- Route `validateAccessCode` through `isAccessCodeExpired` to enforce one canonical expiration policy.

## Risk and blast radius
- Low blast radius: single conditional path in invite/access-code validation.
- Reduced regression risk by eliminating duplicate expiration logic.
