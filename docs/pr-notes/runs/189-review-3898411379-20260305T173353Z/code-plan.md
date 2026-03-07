# Code Role (Fallback Manual Synthesis)

## Implementation Scope
- `js/live-tracker-chat-unread.js`
  - Add input/output field `lastChatSnapshotIds`.
  - Count unread when `ts > lastChatSnapshotAt` or `ts === lastChatSnapshotAt` with unseen message ID.
  - Track IDs present at newest timestamp for next snapshot comparison.
- `js/live-tracker.js`
  - Bump unread-helper import cache version.
  - Add `liveState.lastChatSnapshotIds` default and plumb into unread helper call/result.
  - Clear tie-break IDs when chat expands/resets.
- `tests/unit/live-tracker-chat-unread.test.js`
  - Extend message fixture to include `id`.
  - Add regression test for same-millisecond net-new message counting.
