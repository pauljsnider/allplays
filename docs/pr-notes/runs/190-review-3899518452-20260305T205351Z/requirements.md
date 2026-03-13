# Requirements role

## Objective
Address PR #190 review findings without expanding scope beyond notification correctness and security.

## User-visible outcomes
- Team admin recipients are resolved from trusted identity records, not mutable profile data.
- Chat notifications fire for text messages and image-only posts.
- Notification delivery remains reliable when token count exceeds 500.

## Acceptance criteria
- Non-admin users cannot receive admin-targeted pushes by editing `users/{uid}.email`.
- `notifyTeamChatMessageCreated` sends when `text` is empty but `imageUrl` is present.
- `sendCategoryNotification` chunks FCM sends to max 500 tokens per request.
- Existing payload fields (`teamId`, `gameId`, `category`, `link`) remain unchanged.
