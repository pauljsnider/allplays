# QA analysis

Bound to starting SHA `98bea9bf5428a41ad056c1c147ba8fddc5a6eb34`.

Use an in-memory Firestore transaction harness that clones documents, enforces reads before writes, stages writes until callback success, discards staged writes on failure, serializes concurrent attempts, and records committed batches.

## Matrix

- Verified email and verified E.164 phone success.
- Exactly one committed batch containing the friendship and invite paths.
- Sequential replay and concurrent double redemption with zero additional writes.
- Generic zero-write rejection for identity mismatch, self-redemption, expired or malformed expiry, used markers, missing/wrong-type/inactive invite, blocked status, nonempty or malformed `blockedBy`, and malformed participants.
- Injected post-callback transaction failure rolls back both staged writes.
- Every rejection has the same code/message/no-details shape and logs no stored identity or inviter values.

For zero-write proof, compare the complete document map before and after and assert no committed batch was added.

Focused command: `node --test functions/test/friend-invite-redemption.test.cjs`.
