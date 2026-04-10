# Code plan

Thinking level: medium

1. Extend opponent-stats unit coverage with a source-backed interaction harness for `live-tracker.js`.
2. Prove the current delete handler removes local state but does not schedule persisted opponent snapshot updates.
3. Patch the delete handler to queue opponent-stats sync and `liveHasData` writes.
4. Run targeted unit tests for the changed area, then run the full unit suite if it is stable in this repo.
5. Commit the fix and tests together with an issue-referencing message.
