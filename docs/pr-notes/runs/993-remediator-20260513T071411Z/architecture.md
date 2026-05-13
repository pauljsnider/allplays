# Architecture Notes

## Decision
Add a small local helper in `team-chat.html` that captures `messages-container.scrollHeight` and `scrollTop`, runs the older-message load, then restores `scrollTop` with the height delta.

## Rationale
- Keeps pagination logic centralized in `loadMessages(true)`.
- Matches the existing load-more scroll preservation pattern, while preserving non-zero scroll positions too.
- Avoids changing Firestore queries, media collection, modal rendering, or realtime chat behavior.

## Risk And Rollback
- Risk is limited to chat viewport scroll math after prepending older messages.
- Rollback is removing the helper usage and returning to direct `loadMessages(true)` calls.
