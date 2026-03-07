# QA Analysis

- Test focus: regression for same-millisecond collision after snapshot timestamp has advanced.
- Manual checks:
  - Collapsed chat receives first message at new ms => unread +1.
  - Next snapshot adds second message with same ms => unread increments again.
  - Replayed snapshots with same message IDs do not double count.
- Automated checks:
  - Run `npx vitest run tests/unit/live-tracker-chat-unread.test.js`.
