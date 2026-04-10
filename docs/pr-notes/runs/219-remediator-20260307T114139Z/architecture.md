Thinking level: medium
Reason: single-threaded client fix with a clear failure mode, but it touches persistence sequencing.

Architecture decision:
- Preserve the two-phase finish flow already in the page.
- Bound only the second-phase tournament advancement writes with sequential chunked `writeBatch` commits.

Why this path:
- Smallest change that gets the behavior back inside Firestore constraints.
- No schema changes, no new modules, no changes to primary finish semantics.
- Sequential commits keep ordering deterministic and are easy to reason about during retries.

Tradeoffs:
- If a later chunk fails, some advancement backfill may still be partially applied, but the game itself is already finalized today. This change specifically removes the guaranteed >500-op failure case.
- A larger redesign could make the entire finish flow idempotent, but that is outside this review thread.

Rollback plan:
- Revert the chunking loop in `track-live.html` and the matching unit test if it causes unexpected behavior.
