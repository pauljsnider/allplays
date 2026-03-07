# QA Role Analysis

Failure reproduction model:
- Collapsed chat + sequential snapshots where `lastChatSeenAt` stays constant.
- Snapshot 1 adds +1, snapshot 2 recounts old + new => +2, snapshot 3 => +3.

Regression tests to add:
1. Collapsed snapshot progression counts only net-new messages (1,2,3 total not 1,3,6).
2. Expanded mode reset clears unread and updates both watermarks.
3. Missing timestamps are counted once per snapshot and do not multiply in later snapshots.

Validation scope:
- Run targeted unit tests for new helper and existing live-tracker-related unit tests.
- Confirm no unrelated file behavior changes.
