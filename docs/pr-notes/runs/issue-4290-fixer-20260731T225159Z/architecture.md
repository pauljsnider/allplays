# Architecture

Starting SHA: `59fcfa8258155562abf1a4a6033373a027b5fe09`

## Current state

The callable authorizes and deduplicates an exact team/player/recipient tuple but has no durable sender or recipient budget. The existing resend cooldown is code-scoped and does not bound initial invite creation. In-memory limiting would reset across callable instances.

## Proposed flow

1. Authenticate, validate IDs, normalize the recipient, and build code-independent sender and recipient boundaries.
2. In the existing Firestore transaction, read authorization records, the active-invite query, idempotency record, both limiter documents, and the candidate access-code record before staging writes.
3. Reject unauthorized callers before quota evaluation. Return an active exact invite without changing limiter state.
4. Evaluate both fixed-window reservations. If either is exhausted, throw a generic `resource-exhausted` error and abort every staged mutation.
5. If both allow, stage both limiter updates, invite creation, and idempotency update in the same transaction.
6. Let the existing access-code on-create trigger enqueue the initial email after commit. Rejection and reuse produce no create event.

## Data and safety

- Store rate state in isolated `coParentInviteRateLimits` documents keyed by SHA-256 hashes of domain-separated boundaries.
- Persist only count, reset time, and expiry metadata. Never persist raw UID or recipient values in limiter state.
- Sender scope is global per authenticated UID. Recipient scope is global per normalized email.
- Firestore conflict retries serialize shared boundaries. Same-tuple concurrency also serializes through the deterministic idempotency document.
- Rollback is a function-code rollback. Existing limiter documents are inert outside this callable and expire naturally.

## Blast radius

Only the co-parent invite callable and a new isolated limiter collection change. Authorization, redemption, other invite types, client behavior, and rules are unchanged.
