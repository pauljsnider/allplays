# Architecture role (inline fallback)

- Current state: `retryChatLastReadOnViewReturn()` can call `maybeUpdateChatLastRead()` immediately after focus/visibility return if cached messages exist.
- Risk: Writes `Timestamp.now()` before delayed snapshot delivery, potentially suppressing unread counts for messages that arrive later with `createdAt <= chatLastRead`.
- Proposed state: Add resume lifecycle flags in `team-chat.html`:
  - mark pending freshness when returning to view
  - clear pending only after next realtime snapshot callback
  - allow retry only when pending is clear and at least one snapshot has loaded
- Blast radius: Team chat page last-read update timing only.
