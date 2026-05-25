# Requirements

## Acceptance Criteria
- Canceling a tracked/live game must reset game status fields without attempting client-side deletion of immutable `liveEvents` documents.
- Existing live event history remains immutable and governed by Firestore rules.
- Regression coverage must assert `cancelGame` does not call `deleteDoc` for `liveEvents` while preserving reset behavior.

## Notes
Subagent spawning was unavailable in this runtime, so this is inline role analysis per fallback instruction.
