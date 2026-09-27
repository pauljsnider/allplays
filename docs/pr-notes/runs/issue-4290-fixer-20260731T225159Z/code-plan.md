# Code Plan

Starting SHA: `59fcfa8258155562abf1a4a6033373a027b5fe09`

1. Refactor `functions/rate-limit.cjs` to expose a transaction-compatible prepared fixed-window reservation while preserving the standalone limiter API.
2. Inject an isolated limiter collection, window, sender maximum, and recipient maximum into `createCoParentInviteHandler`.
3. Build domain-separated sender and normalized-recipient reservations independent of invite codes.
4. Read both limiter documents and the candidate access-code document before any transaction write. Return active reuse before quota enforcement.
5. Reject atomically when either reservation is exhausted; otherwise stage both limiter writes with invite and idempotency writes.
6. Wire positive environment/runtime configuration in `functions/index.js` with finite defaults: 24-hour window, 10 sender invites, and 3 recipient invites.
7. Extend focused invite and limiter tests for exhaustion, normalization, persistence, reuse, concurrency, hashed boundaries, and rollback.

## Risks

- Firestore disallows reads after writes begin, so every snapshot must be acquired first.
- Generated invite identifiers must never participate in the stable abuse boundaries.
- Limiter contention is intentional and bounded to callers sharing a sender or recipient.
- Collision retries must abort limiter mutations with the failed invite attempt.
