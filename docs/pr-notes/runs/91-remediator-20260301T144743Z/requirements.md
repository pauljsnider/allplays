# Requirements role notes

Objective: Resolve PR #91 unresolved review threads with minimal scoped changes.

Feedback to satisfy:
1. Ensure tests and `shouldUpdateChatLastRead` signature align. No phantom `initialSnapshotLoaded` parameter should be required.
2. Ensure `updateChatLastRead` is gated so last-read only advances while chat is actively viewed (tab visible and focused).

Acceptance criteria:
- Unit tests reflect actual function inputs and behavior.
- Production call site only updates last-read when active-view guard passes.
- No unrelated refactors.
