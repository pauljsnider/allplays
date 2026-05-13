# Code Plan

## Implementation Plan
- Add `loadOlderMessagesPreservingScroll()` near the existing scroll helpers in `team-chat.html`.
- The helper will read `messages-container`, store `scrollHeight` and `scrollTop`, await `loadMessages(true)`, then set `scrollTop` to `scrollTopBefore + (scrollHeightAfter - scrollHeightBefore)` when messages were loaded.
- Replace direct `loadMessages(true)` usage in `loadMediaGalleryHistory()` with the helper.
- Use the same helper in the load-more button handler to keep behavior consistent and avoid duplicate scroll math.

## Scope Control
No changes to gallery rendering, media actions, Firestore queries, or realtime listeners.
