# Team Chat Design

**Status: IMPLEMENTED**

Goal: Add persistent team chat for anyone who has access to a team (owner, admin email, global admin, or parent). History is permanent.

## Implementation Summary

### Completed Features
- Team chat page (`team-chat.html`) with full messaging functionality
- Access for owners, admins, global admins, and parents
- Entry points from coach dashboard, parent dashboard, and team admin banner
- Profile photo upload on profile.html
- Message editing (own messages only)
- Message deletion (own messages, or any message for moderators)
- Pagination (50 messages per load)
- Manual refresh button

### Deferred Features
- Real-time updates (Firestore onSnapshot) - using manual refresh instead
- Push notifications (FCM)
- Image/file attachments
- Message reactions/emoji
- Threaded replies
- Read receipts
- Typing indicators
- Message search

## Architecture Fit
- Frontend: existing static pages + JS modules (`js/auth.js`, `js/db.js`, `js/utils.js`), Tailwind UI
- Backend: Firebase Auth + Firestore
- Data stays inside each `team` namespace to match the rest of the app

## Data Model (Firestore)
- Collection: `teams/{teamId}/chatMessages/{messageId}`
  - `text: string`
  - `senderId: string`
  - `senderName: string`
  - `senderEmail: string`
  - `senderPhotoUrl: string` (optional)
  - `createdAt: Timestamp`
  - `editedAt: Timestamp` (optional, set when edited)
  - `deleted: boolean` (soft delete flag)

## Access Control
A user can read/post if they have team access:
- `team.ownerId == uid`, or
- user email in `team.adminEmails`, or
- `isGlobalAdmin` (`users.isAdmin == true`), or
- parent linked to any player on the team (`user.parentOf` contains teamId)

Moderation (delete others' messages):
- Team owner, team admins, or global admin

## Entry Points
1. **Coach Dashboard** (`dashboard.html`): Chat button on each team card
2. **Parent Dashboard** (`parent-dashboard.html`): Team Chats section with links to each team
3. **Team Admin Banner** (`team-admin-banner.js`): Chat navigation card on all edit pages

## Files Changed
| File | Changes |
|------|---------|
| `js/db.js` | Added `uploadUserPhoto`, `canAccessTeamChat`, `canModerateChat`, `getChatMessages`, `postChatMessage`, `editChatMessage`, `deleteChatMessage` |
| `profile.html` | Added profile photo upload section |
| `dashboard.html` | Added Chat button to team cards |
| `parent-dashboard.html` | Added Team Chats section |
| `js/team-admin-banner.js` | Added Chat icon and navigation card |
| `team-chat.html` | NEW - Full chat page |
| `firestore.rules` | Added `canAccessTeamChat` helper and `chatMessages` subcollection rules |

## Firestore Index Required
Create a composite index for `teams/{teamId}/chatMessages` ordered by `createdAt` descending:
- Collection: `chatMessages`
- Field: `createdAt` (Descending)

This index may be auto-created when the first query runs, or can be created manually in Firebase Console.

## Deployment
1. Deploy Firestore rules: `firebase deploy --only firestore:rules`
2. The chat page and all JS changes are static and deploy with normal site deployment

## Testing Scenarios
- [x] Coach can access chat for owned teams
- [x] Admin (via adminEmails) can access chat
- [x] Parent can access chat for linked teams
- [x] Global admin can access any team chat
- [x] Unauthenticated user redirected to login
- [x] User without team access redirected to dashboard
- [x] Send message appears in list
- [x] Edit own message shows "edited" indicator
- [x] Delete own message shows "Message removed"
- [x] Coach/Admin can delete any message (moderation)
- [x] Parent cannot delete others' messages
- [x] Pagination loads older messages on demand
- [x] Profile photo appears in messages
