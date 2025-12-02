# Team Chat Design

Goal: Add persistent team chat for anyone who currently has access to a team (owner, admin email, global admin; extendable to parents when parent role ships). History is permanent.

## Architecture Fit
- Frontend: existing static pages + JS modules (`js/auth.js`, `js/db.js`, `js/utils.js`), Tailwind UI. Add a chat UI panel/page.
- Backend: Firebase Auth + Firestore; optional Cloud Functions for push notifications (FCM) and fan-out; service worker for web push.
- Data stays inside each `team` namespace to match the rest of the app.

## Data Model (Firestore)
- Collection: `teams/{teamId}/chatMessages/{messageId}`
  - `text: string`
  - `senderId: string`
  - `senderName: string`
  - `senderEmail: string`
  - `createdAt: Timestamp`
  - `editedAt?: Timestamp`
  - `deleted?: boolean`
  - `attachments?: [{ url, name, size, contentType }]` (optional future)
  - `replyTo?: messageId` (optional future threading)
- Team cached metadata (optional):
  - `teams/{teamId}.chatLastMessage`, `chatLastMessageAt`, `chatLastSenderName` for list previews.
- Device tokens for notifications: store under `users/{uid}.fcmTokens[token] = { createdAt, platform }` when permission granted.

## Access Control
- A user can read/post if they have team access:
  - `team.ownerId == uid`, or
  - user email in `team.adminEmails`, or
  - `isGlobalAdmin` (`users.isAdmin == true`), or
  - future: parent linked to player on the team.
- Chat is public to authorized members; no TTL on messages.

### Firestore Rules Sketch
```
function isTeamMember(teamId) {
  return isSignedIn() && (
    get(/databases/$(database)/documents/teams/$(teamId)).data.ownerId == request.auth.uid ||
    (request.auth.token.email != null && request.auth.token.email.lower() in get(/databases/$(database)/documents/teams/$(teamId)).data.get('adminEmails', [])) ||
    isGlobalAdmin()
  );
}

match /teams/{teamId}/chatMessages/{msgId} {
  allow read, create: if isTeamMember(teamId);
  allow update, delete: if isTeamMember(teamId) && request.auth.uid == resource.data.senderId; // allow sender edits; admin override optional
}
```
Add edit/delete override for global admins if desired.

## UI/UX
- Entry points:
  - `team.html`: add a “Chat” tab/section for the selected team.
  - Optional standalone `team-chat.html#teamId=...` for deeper linking.
- Layout:
  - Message list (reverse chronological or bottom-up), sticky composer at bottom.
  - Show sender name/email, timestamp, and “edited” badge if applicable.
  - Infinite scroll/pagination via Firestore `limit` + `startAfter`.
- Composer:
  - Text input + Send button; optional file attach later.
  - Disable send when empty or while posting.
- Presence/read receipts (optional later): track `lastSeenAt` per user in UI state, not persisted initially.

## Client Logic
- New DB helpers (`js/db.js`):
  - `async getChatMessages(teamId, { limit = 50, startAfter = null })` → query `chatMessages` ordered by `createdAt`.
  - `subscribeToChat(teamId, callback)` → `onSnapshot` for real-time updates.
  - `postChatMessage(teamId, message)` → add doc with `createdAt: Timestamp.now()`.
  - `editChatMessage(teamId, messageId, updates)` → set `editedAt` and text.
  - `deleteChatMessage(teamId, messageId)` → soft-delete (`deleted: true`).
- Auth gating: reuse `checkAuth` + `hasAccess(team, user)` pattern from `edit-schedule.html`/`edit-roster.html`.
- Rendering: escape text with `escapeHtml`; replace deleted messages with “Message removed”.
- Pagination: load initial 50; on scroll up, fetch older via `startAfter` cursor.

## Notifications (optional but recommended)
- Frontend:
  - Add Messaging SDK + permission prompt.
  - Register service worker `firebase-messaging-sw.js` (root); cache token in `users/{uid}.fcmTokens`.
- Cloud Function:
  - Trigger on `teams/{teamId}/chatMessages/{messageId}` create.
  - Collect tokens for team members (owner/adminEmails/global admin; future parents) excluding sender.
  - Send FCM notification payload `{ title: team.name, body: text[0:80], data: { teamId } }`.
- Known constraint: iOS Safari push works only for installed PWAs; acceptable.

## Performance & Limits
- One chat collection per team; messages retained forever.
- Index: composite `teams/{teamId}/chatMessages` on `createdAt` for ordering.
- Pagination to avoid unbounded reads; consider client-side virtualization for long histories.

## Backward Compatibility
- No schema changes to games/teams; chat is additive.
- Access check mirrors existing team edit checks to avoid new membership concepts until parent role is live.

## Testing Scenarios
- Authorized user can send/read; unauthorized user blocked by rules.
- Long history loads in pages; scrolling up fetches older messages.
- Sender can edit/delete own message; others cannot; admin override if enabled.
- Notifications: sender doesn’t get notified; other team members do (desktop/Android Chrome).
