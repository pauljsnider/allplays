# Requirements Notes

## Acceptance Criteria
- Confirming a parent account merge must never leave duplicate `parents[]` entries with the same non-empty `userId` on an affected player document.
- The validation must run inside the Firestore transaction that reads and updates player documents so retries re-check the latest player state.
- Existing idempotency must remain intact: rerunning the same merge after source UID has been rewritten to destination UID should not create a change.

## Assumptions
- Parent entries without `userId` may still be keyed by email or full object by existing merge logic.
- The review concern is scoped to player `parents[]` integrity, not notification preference merging.

## Edge Cases
- Player already has source and destination parent entries.
- Player already has duplicate destination entries from a previous partial/racy operation.
- Concurrent transaction retry observes a newer player parent array and must validate the recomputed final array.
