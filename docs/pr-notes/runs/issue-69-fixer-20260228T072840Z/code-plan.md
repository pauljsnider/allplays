# Code Role Output (manual fallback)

## Minimal patch plan
1. Add `js/team-chat-last-read.js` helper exporting `shouldUpdateChatLastRead`.
2. Add unit test file `tests/unit/team-chat-last-read.test.js` capturing bug expectation (subsequent snapshots should update).
3. Wire helper into `team-chat.html` realtime callback and call `updateChatLastRead` whenever helper returns true.
4. Run targeted unit tests, then full unit suite if feasible.

## Conflict resolution synthesis
- Requirements/QA demand correctness of unread counts over session lifetime.
- Architecture cautions write volume; resolved by a single boolean guard helper and no broader refactor.
