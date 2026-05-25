# Code Plan

## Implementation Plan
- Remove `liveEvents` collection/query/delete logic from `cancelGame` in `track-live.html`.
- Remove now-unused Firestore imports only if they become unused.
- Update regression test to assert there is no `liveEvents` deletion in `cancelGame`, while preserving reset-state assertions.
