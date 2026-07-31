# Requirements

Starting SHA: `59fcfa8258155562abf1a4a6033373a027b5fe09`

## Invariants

- Authenticate and authorize the caller against the exact `teamId::playerId` before consuming quota.
- Use the authenticated UID as the global sender boundary and the trimmed, lowercased email as the global recipient boundary.
- Reuse an existing active team/player/recipient invite before rate-limit evaluation. Reuse creates no invite, initial email event, or quota consumption.
- For a new invite, both durable reservations, access-code creation, and idempotency state commit in one transaction.
- Either exhausted boundary returns `resource-exhausted` without consuming the other boundary or creating invite, idempotency, or mail-triggering state.
- Concurrent requests cannot exceed either configured limit or create duplicate active invites.
- Hash boundary document IDs so UID and email values are not exposed in limiter paths.

## Root cause

Issue #4289 added exact-link authorization and tuple-level idempotency, but it did not add persistent sender- or recipient-scoped budgets. A linked parent can vary the player or recipient and create unbounded access-code records, each of which triggers an initial email. The existing durable limiter owns its own transaction, so invoking it before or after invite creation cannot provide all-or-nothing behavior.

## Assumptions and boundaries

- Fixed-window semantics are consistent with the existing durable limiter.
- Email normalization remains trim plus lowercase only. Provider-specific alias folding is out of scope.
- Initial mail enqueue remains asynchronous. Atomic invite rejection guarantees no access-code create event and therefore no initial mail enqueue.
- Client UI, Firestore client-create rules, other invite types, and redemption remain out of scope.
- Thresholds were not specified. The core will accept injected positive settings and production composition will use finite defaults.

## Success measures

- Focused tests cover sender and normalized-recipient exhaustion, cross-instance persistence, active reuse, concurrent contention, duplicate prevention, and rollback of rejected requests.
- Tests assert committed state, not mock call order.
- The focused co-parent invite and rate-limit suites pass at the committed SHA.
