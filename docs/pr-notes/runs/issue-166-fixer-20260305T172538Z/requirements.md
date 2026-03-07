# Requirements Role Analysis

Objective: Fix unread chat badge inflation in live tracker collapsed-chat mode.

Current state:
- `updateUnread(messages)` runs on each snapshot.
- In collapsed mode it counts all messages newer than `lastChatSeenAt` and adds to cumulative unread each time.
- `lastChatSeenAt` is only updated when chat is expanded.

Proposed state:
- Unread badge increments exactly once per newly arrived message while collapsed.
- Previously counted unseen messages are not counted again.

User-impact acceptance criteria:
1. First new message while collapsed sets unread to 1.
2. Each additional new message increments by exactly 1.
3. Expanding chat resets unread to 0 and updates seen baseline.
4. No behavior regression when chat is already expanded.

Assumptions:
- Snapshot payload is latest-window list ordered by recency/createdAt.
- Missing timestamps can occur; they should still be treated as unread once.

Decision:
- Use a per-snapshot cursor baseline (`lastChatSnapshotAt`) to count only messages newer than the previous snapshot, while retaining `lastChatSeenAt` for read semantics.
