# Architecture Role Notes

Current state:
- `isAccessCodeExpired(expiresAt, nowMs)` normalizes Timestamp-like, Date, and numeric inputs.
- Expiration comparison is inclusive (`nowMs >= expiresAtMs`).
- Null/undefined expirations are treated as non-expiring.

Risk surface:
- Incorrect boundary comparison can allow redemption at expiration instant.
- Falsy numeric handling (0) can bypass expiration if guarded incorrectly.

Proposed state:
- Preserve inclusive boundary behavior in helper.
- Confirm behavior contract via explicit unit tests across all supported input types.

Blast radius:
- Low; helper-level change validation only. No API changes.
