# Team Chat Implementation Tasks

## Phase 1: Profile Photo Upload

- [ ] **1.1** Add `uploadUserPhoto(file)` function to `js/db.js`
  - Mirror existing `uploadTeamPhoto` pattern
  - Upload to `user-photos/` path in Firebase Storage
  - Returns download URL
  - *Ref: Req 1.6*

- [ ] **1.2** Add photo upload UI to `profile.html`
  - Add photo section before Full Name field
  - Show current photo (80x80 rounded) or default avatar
  - File input with preview on selection
  - *Ref: Req 1.1, 1.2, 1.3, 1.4*

- [ ] **1.3** Wire up photo save in `profile.html`
  - On Save Profile, upload photo if changed
  - Store `photoUrl` in user profile document
  - Show upload progress/status
  - *Ref: Req 1.5*

## Phase 2: Database & Security

- [ ] **2.1** Add chat helper functions to `js/db.js`
  - `canAccessTeamChat(user, team)` - returns boolean
  - `canModerateChat(user, team)` - returns boolean for delete permissions
  - *Ref: Req 2.1-2.4, Design Section 6*

- [ ] **2.2** Add chat CRUD functions to `js/db.js`
  - `getChatMessages(teamId, { limit, startAfter })`
  - `postChatMessage(teamId, messageData)`
  - `editChatMessage(teamId, messageId, newText)`
  - `deleteChatMessage(teamId, messageId)`
  - *Ref: Design Section 5*

- [ ] **2.3** Update `firestore.rules` with chatMessages rules
  - Add `canAccessChat(teamId)` helper function
  - Add match block for `/chatMessages/{messageId}`
  - Allow read/create for team members
  - Allow update (edit) for message sender only
  - Allow update (delete) for sender OR team owner/admin
  - *Ref: Req 2.1-2.4, 7.4, 8.1-8.2, Design Section 6.2*

## Phase 3: Chat Entry Points

- [ ] **3.1** Add Chat button to `dashboard.html` team cards
  - Add Chat button after View in quick actions grid
  - Link to `team-chat.html#teamId=${team.id}`
  - Show for both full access and parent access teams
  - Add chat bubble icon
  - *Ref: Req 3.1*

- [ ] **3.2** Add Team Chats section to `parent-dashboard.html`
  - Add section showing unique teams from parentOf
  - Each team links to `team-chat.html#teamId=${teamId}`
  - Display team name and photo
  - *Ref: Req 3.2*

- [ ] **3.3** Add Chat nav card to `js/team-admin-banner.js`
  - Add chat icon function
  - Add `chat` to hrefs object
  - Add Chat action card to grid
  - Update grid layout for 7 items
  - *Ref: Req 3.3*

## Phase 4: Chat Page Core

- [ ] **4.1** Create `team-chat.html` base structure
  - HTML boilerplate matching other pages
  - Import modules (auth, db, utils, team-admin-banner)
  - Parse teamId from URL hash
  - Render header/footer
  - *Ref: Req 3.4*

- [ ] **4.2** Add access control to `team-chat.html`
  - Check authentication (redirect to login if not)
  - Load team document
  - Verify user has chat access (redirect if not)
  - Load user profile for sender info
  - *Ref: Req 2.1-2.5, 10.3*

- [ ] **4.3** Render team admin banner in `team-chat.html`
  - Call `renderTeamAdminBanner` with active='chat'
  - Show team context (name, photo)
  - *Ref: Req 4.1*

- [ ] **4.4** Add message list container to `team-chat.html`
  - Scrollable container for messages
  - Loading state while fetching
  - Empty state when no messages
  - *Ref: Req 4.2*

- [ ] **4.5** Implement message loading in `team-chat.html`
  - Call `getChatMessages(teamId)` on page load
  - Render messages in chronological order (reverse the desc query result)
  - Auto-scroll to bottom after load
  - *Ref: Req 4.4, 9.1*

- [ ] **4.6** Add message rendering function
  - Display sender photo (or default avatar)
  - Display sender name or email
  - Display timestamp
  - Display "edited" indicator if editedAt exists
  - Display "Message removed" if deleted
  - Style own messages differently (right-aligned, primary color)
  - *Ref: Req 5.1-5.6*

## Phase 5: Sending Messages

- [ ] **5.1** Add composer UI to `team-chat.html`
  - Text input field
  - Refresh button
  - Send button
  - Sticky at bottom of viewport
  - *Ref: Req 4.5, 6.1, 6.2*

- [ ] **5.2** Implement send functionality
  - Disable Send when input empty/whitespace
  - Disable Send while submitting
  - Call `postChatMessage` with user info
  - Clear input on success
  - Refresh message list after send
  - *Ref: Req 6.3-6.7*

- [ ] **5.3** Implement refresh functionality
  - Refresh button reloads messages
  - Show loading indicator
  - Maintain scroll position if not at bottom
  - *Ref: Req 4.5*

- [ ] **5.4** Add error handling for send
  - Show error message on failure
  - Retain composed text in input
  - *Ref: Req 10.1*

## Phase 6: Edit & Delete

- [ ] **6.1** Add edit/delete buttons to own messages
  - Show Edit and Delete buttons on hover/focus
  - Only for current user's messages
  - *Ref: Req 7.1, 8.1*

- [ ] **6.2** Add delete button for moderators
  - Show Delete button on others' messages for owner/admin
  - Use `canModerateChat` to check permission
  - *Ref: Req 8.2*

- [ ] **6.3** Implement edit functionality
  - Click Edit shows inline text input with current text
  - Save updates message and sets editedAt
  - Cancel restores original display
  - Refresh list after edit
  - *Ref: Req 7.2, 7.3*

- [ ] **6.4** Implement delete functionality
  - Confirm before deleting
  - Call `deleteChatMessage` (soft delete)
  - Refresh list after delete
  - *Ref: Req 8.3, 8.4*

## Phase 7: Pagination

- [ ] **7.1** Add "Load older messages" button
  - Show at top of message list
  - Hidden if fewer than 50 messages returned
  - *Ref: Req 9.2, 9.5*

- [ ] **7.2** Implement pagination loading
  - Track last message cursor (createdAt)
  - Load older 50 on button click
  - Prepend to message list
  - Maintain scroll position
  - Show loading indicator
  - Hide button if no more messages
  - *Ref: Req 9.2-9.5*

## Phase 8: Polish & Error Handling

- [ ] **8.1** Add error state for chat load failure
  - Display error message
  - Show retry button
  - *Ref: Req 10.2*

- [ ] **8.2** Add loading states
  - Initial page load spinner
  - Message send spinner
  - Pagination loading indicator
  - *Ref: Req 9.4*

- [ ] **8.3** Deploy Firestore rules
  - Run `firebase deploy --only firestore:rules`
  - Verify rules in Firebase console

## Phase 9: Validation

- [ ] **9.1** Test profile photo upload
  - Upload new photo, verify appears in profile
  - Verify photo persists after page reload
  - Verify photo URL saved in Firestore user document

- [ ] **9.2** Test chat access control
  - Coach can access chat for owned teams
  - Admin (adminEmails) can access chat
  - Parent can access chat for linked teams
  - Global admin can access any team chat
  - Unauthenticated user redirected to login
  - User without team access redirected to dashboard

- [ ] **9.3** Test message CRUD operations
  - Send message, verify appears in list
  - Edit own message, verify "edited" indicator
  - Delete own message, verify "Message removed"
  - Verify cannot edit others' messages

- [ ] **9.4** Test moderation permissions
  - Coach can delete any message in their team
  - Admin can delete any message
  - Parent cannot delete others' messages
  - Global admin can delete any message

- [ ] **9.5** Test pagination
  - Create >50 messages, verify initial load shows 50
  - Click "Load older", verify older messages appear
  - Verify scroll position maintained
  - Verify button hidden when no more messages

- [ ] **9.6** Test entry points
  - Verify Chat button works from dashboard.html
  - Verify Chat link works from parent-dashboard.html
  - Verify Chat nav card works from team admin banner
  - Verify all links include correct teamId

- [ ] **9.7** Test error scenarios
  - Disconnect network, verify error state on load
  - Disconnect network, verify error on send (text retained)
  - Verify retry button works

- [ ] **9.8** Cross-browser testing
  - Test in Chrome
  - Test in Safari
  - Test in Firefox
  - Test on mobile (responsive layout)

## Phase 10: Documentation Updates

- [ ] **10.1** Update `/docs/team-chat.md`
  - Mark feature as implemented
  - Update any design changes made during implementation
  - Document any deferred items

- [ ] **10.2** Add inline code comments
  - Document `canAccessTeamChat` and `canModerateChat` functions
  - Document chat CRUD functions in db.js
  - Document Firestore rules for chatMessages

- [ ] **10.3** Update README if applicable
  - Add team chat to feature list
  - Document any new environment requirements

- [ ] **10.4** Create user-facing documentation (if needed)
  - How to access team chat
  - How to send/edit/delete messages
  - Moderation capabilities for coaches
