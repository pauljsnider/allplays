# Code Role Plan

Plan:
1. Add a pure helper module for unread state transitions so logic is unit-testable.
2. Write failing unit test that reproduces repeated-snapshot overcount.
3. Wire helper into `updateUnread` in `js/live-tracker.js` with minimal state additions.
4. Run targeted tests.
5. Commit fix + tests referencing issue #166.

Conflict resolution synthesis:
- Requirements and QA require exact increment semantics; architecture proposes split watermarks.
- Chosen implementation: split watermarks (`lastChatSeenAt` for read, `lastChatSnapshotAt` for incremental counting) with zero schema/API changes.
