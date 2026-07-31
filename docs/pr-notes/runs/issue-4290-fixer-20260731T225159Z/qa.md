# QA Strategy

Starting SHA: `59fcfa8258155562abf1a4a6033373a027b5fe09`

Baseline: `node --test test/co-parent-invite-core.test.cjs test/rate-limit.test.cjs` passed 20/20 before implementation.

## Regression matrix

- Sender exhaustion: a second distinct invite from one caller rejects, leaves one access code, and does not create the rejected recipient bucket.
- Normalized-recipient exhaustion: case and whitespace variants share one durable recipient bucket across handlers and callers.
- Cross-instance persistence: handlers sharing Firestore cannot bypass exhaustion with a new generated invite code.
- Active reuse: an exact active invite returns after buckets are full without new invite, idempotency, limiter, or mail state.
- Concurrent sender contention: with a maximum of one, exactly one distinct invite commits and the other rejects.
- Concurrent equivalent requests: one creates, one reuses, and each boundary is charged once.
- Rejection rollback: pre-existing exhausted state remains unchanged, with no counterpart reservation or invite-related write.

## Harness and commands

Extend the in-memory Firestore harness to accept the limiter collection and preserve transactional conflict retries. Assert committed documents and writes. Use fixed timestamps and deterministic invite codes.

Run:

```text
cd functions && node --test test/co-parent-invite-core.test.cjs
cd functions && node --test test/rate-limit.test.cjs
cd functions && node --test test/co-parent-invite-core.test.cjs test/rate-limit.test.cjs
```

## Adjacent risks

All transaction reads must precede writes. Invite-code and transaction retries must not double-charge. Boundary keys must exclude generated IDs. The client error must not reveal whether sender or recipient state caused rejection.
