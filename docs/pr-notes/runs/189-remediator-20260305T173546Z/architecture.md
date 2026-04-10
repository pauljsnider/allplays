# Architecture Analysis

- Thinking level: medium (state-machine edge case with repeated snapshots).
- Decision: Use composite checkpoint `{lastChatSnapshotAt, lastChatSnapshotIds[]}` rather than timestamp-only checkpoint.
- Why: Timestamp-only checkpoint cannot distinguish unseen docs sharing same `toMillis()` value; carrying IDs at checkpoint timestamp restores correctness without broad refactor.
- Controls/rollback:
  - No persistence format changes.
  - Localized to in-memory client state.
  - Rollback is single-file revert if regressions appear.
