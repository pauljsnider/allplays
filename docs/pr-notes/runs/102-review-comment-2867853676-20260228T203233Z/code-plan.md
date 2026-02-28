# Code Role Summary

## Patch plan
- Replace inline expiration logic in `validateAccessCode` with `isAccessCodeExpired(data.expiresAt)`.
- Keep error contract unchanged (`{ valid: false, message: \"Code has expired\" }`).

## Conflict resolution
- Requirements and QA both require explicit support for `expiresAt: 0`.
- Architecture preference for single source of truth resolves potential drift between invite flows.
