# Team Chat Feature Requirements

## Introduction

Add a persistent team chat feature that enables communication between coaches, admins, and parents within a team context. The chat provides a centralized place for team-related discussions, announcements, and coordination. Messages are retained permanently and visible to all authorized team members.

This feature includes a prerequisite: adding profile photo upload to the user profile page.

## User Stories

### US-1: User uploads profile photo
As a user, I want to upload a profile photo so that other team members can recognize me in the chat.

### US-2: Coach sends team announcement
As a coach, I want to send a message to all team members so that I can communicate schedule changes, reminders, or updates without leaving the app.

### US-3: Parent asks question
As a parent, I want to ask questions in the team chat so that I can get clarification from coaches or other parents about team matters.

### US-4: Admin responds to inquiry
As a team admin, I want to respond to parent questions so that I can help manage team communications alongside the head coach.

### US-5: User views chat history
As a team member, I want to scroll through past messages so that I can catch up on discussions I missed.

### US-6: User edits their message
As a message sender, I want to edit my own message so that I can fix typos or clarify my meaning.

### US-7: User deletes their message
As a message sender, I want to delete my own message so that I can remove something I posted by mistake.

### US-8: Admin moderates chat
As a coach or admin, I want to delete any message so that I can remove inappropriate content and maintain a positive team environment.

### US-9: Coach accesses chat from dashboard
As a coach, I want to access the team chat from my dashboard so that I can quickly communicate with team members.

### US-10: Parent accesses chat from dashboard
As a parent, I want to access the team chat from my parent dashboard so that I can communicate with coaches and other parents.

### US-11: Coach accesses chat from management pages
As a coach, I want to access the team chat from the team management banner so that I can switch to chat while managing team settings.

## Requirements (EARS Format)

### 1. Profile Photo Upload (Prerequisite)

1.1 The profile page (profile.html) shall display a photo upload section above the name/phone fields.

1.2 The system shall display the current profile photo if one exists, or a default avatar placeholder if none.

1.3 The system shall provide a file input to select an image file for upload.

1.4 When a user selects an image, the system shall display a preview before saving.

1.5 When a user saves their profile with a new photo, the system shall upload the image to Firebase Storage and store the URL in the user's profile document.

1.6 The system shall use the same upload pattern as team/player photos (firebase-images.js, uploadUserPhoto function in db.js).

### 2. Access Control

2.1 The system shall allow chat access to users who are the team owner (ownerId).

2.2 The system shall allow chat access to users whose email is listed in the team's adminEmails array.

2.3 The system shall allow chat access to users who are global administrators (isAdmin = true).

2.4 The system shall allow chat access to users who are linked as a parent to any player on the team (via parentOf array).

2.5 The system shall NOT display chat access to unauthenticated users.

2.6 The system shall NOT display chat access on the public team page (team.html).

### 3. Navigation & Entry Points

3.1 The system shall provide a "Chat" link on the coach dashboard (dashboard.html) for each team the user has access to.

3.2 The system shall provide a "Chat" link on the parent dashboard (parent-dashboard.html) for each team the user has parent access to.

3.3 The system shall provide a "Chat" navigation card in the team admin banner on all team edit pages.

3.4 When a user clicks a chat entry point, the system shall navigate to a standalone chat page (team-chat.html) with the teamId parameter.

### 4. Chat Page Layout

4.1 The chat page shall display the team name and photo in a header area.

4.2 The chat page shall display messages in chronological order (oldest at top, newest at bottom).

4.3 The chat page shall display a message composer fixed at the bottom of the viewport.

4.4 The chat page shall auto-scroll to the newest message when the page loads.

4.5 The chat page shall provide a manual refresh button to load new messages.

### 5. Message Display

5.1 Each message shall display the sender's profile photo (or a default avatar if none).

5.2 Each message shall display the sender's name, or email if name is not available.

5.3 Each message shall display a timestamp indicating when it was sent.

5.4 If a message has been edited, the system shall display an "edited" indicator.

5.5 If a message has been deleted, the system shall display "Message removed" in place of the content.

5.6 The system shall visually distinguish the current user's messages from other users' messages.

### 6. Sending Messages

6.1 The system shall provide a text input field for composing messages.

6.2 The system shall provide a Send button to submit the message.

6.3 The system shall disable the Send button when the input is empty or whitespace-only.

6.4 The system shall disable the Send button while a message is being submitted.

6.5 When a message is sent, the system shall store it in Firestore with senderId, senderName, senderEmail, senderPhotoUrl, text, and createdAt timestamp.

6.6 The system shall clear the input field after a message is successfully sent.

6.7 After sending a message, the system shall refresh the message list to show the new message.

### 7. Message Editing

7.1 The system shall allow users to edit their own messages.

7.2 When editing, the system shall display the current text in an editable input.

7.3 When an edit is saved, the system shall update the text and set an editedAt timestamp.

7.4 The system shall NOT allow users to edit messages sent by other users (except admins per 8.2).

### 8. Message Deletion

8.1 The system shall allow users to delete their own messages.

8.2 The system shall allow team owners, team admins, and global admins to delete any message (moderation).

8.3 When a message is deleted, the system shall set deleted: true (soft delete) rather than removing the document.

8.4 Deleted messages shall display as "Message removed" to all users.

### 9. Pagination & History

9.1 The system shall initially load the most recent 50 messages.

9.2 When the user scrolls to the top, the system shall load older messages in batches of 50.

9.3 The system shall maintain scroll position when loading older messages.

9.4 The system shall display a loading indicator while fetching older messages.

9.5 If no more messages exist, the system shall not attempt additional fetches.

### 10. Error Handling

10.1 If a message fails to send, the system shall display an error message and retain the composed text.

10.2 If the chat fails to load, the system shall display an error state with a retry option.

10.3 If the user loses access to the team, the system shall redirect them away from the chat page.

## Out of Scope (Deferred)

- Real-time updates (Firestore onSnapshot) - use manual refresh for now
- Push notifications (FCM)
- Image/file attachments
- Message reactions/emoji
- Threaded replies
- Read receipts
- Typing indicators
- Message search
