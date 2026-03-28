# Requirements Analysis

- Objective: Ensure live tracker unread badge counts distinct chat docs even when multiple docs share the same millisecond timestamp.
- Current state: Unread helper tracks `lastChatSnapshotAt` and now also a set of IDs at the snapshot timestamp.
- Proposed state: Preserve this ID-aware dedupe behavior and verify it explicitly for the PR comment scenario where snapshot timestamp advances and a later same-ms message arrives.
- Risk surface: Low, scoped to unread badge state machine in tracker chat.
- Blast radius: `js/live-tracker-chat-unread.js`, `js/live-tracker.js`, and unit test coverage for unread helper.
- Assumptions:
  - Chat messages always include Firestore doc `id`.
  - `createdAt.toMillis()` precision is milliseconds and collisions are expected under load.
