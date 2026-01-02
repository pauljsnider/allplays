# Team Chat Feature Design

## Overview

This document describes the technical design for the team chat feature, including profile photo upload as a prerequisite. The design follows existing patterns in the codebase for consistency.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Entry Points                            │
├─────────────────┬─────────────────┬─────────────────────────────┤
│ dashboard.html  │ parent-dashboard│ team-admin-banner.js        │
│ (Chat button)   │ (Chat button)   │ (Chat nav card)             │
└────────┬────────┴────────┬────────┴──────────────┬──────────────┘
         │                 │                       │
         └─────────────────┴───────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │    team-chat.html       │
              │  #teamId={teamId}       │
              └───────────┬─────────────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────────┐
│  js/db.js   │  │ js/auth.js  │  │ firestore.rules │
│ Chat CRUD   │  │ Access check│  │ Security        │
└──────┬──────┘  └─────────────┘  └─────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│         Firestore Database              │
│  teams/{teamId}/chatMessages/{msgId}    │
└─────────────────────────────────────────┘
```

## Components

### 1. Profile Photo Upload (profile.html)

**Location:** Add photo section before Full Name field in profile.html

**UI Layout:**
```
┌──────────────────────────────────────────┐
│ Profile                                  │
│ Your Account                             │
├──────────────────────────────────────────┤
│  ┌─────────┐                             │
│  │  Photo  │  [Choose File] [Remove]     │
│  │ Preview │                             │
│  └─────────┘                             │
├──────────────────────────────────────────┤
│ Email: user@example.com (read-only)      │
│ Full Name: [___________]                 │
│ Phone: [___________]                     │
│ [Save Profile]                           │
└──────────────────────────────────────────┘
```

**Implementation:**
- Reuse existing photo upload pattern from edit-team.html
- Add `uploadUserPhoto(file)` function to db.js (mirrors `uploadTeamPhoto`)
- Store URL in `users/{uid}.photoUrl`
- Display 80x80 rounded preview (matches team photo style)

### 2. Chat Entry Points

#### 2.1 Coach Dashboard (dashboard.html)

Add "Chat" button to team card quick actions grid, after "View" for all teams:

```html
<a href="team-chat.html#teamId=${team.id}"
   class="flex flex-col items-center justify-center p-3 rounded-lg border ...">
    <svg><!-- chat bubble icon --></svg>
    <span>Chat</span>
</a>
```

Position: After "View" button, visible for both full access and parent access teams.

#### 2.2 Parent Dashboard (parent-dashboard.html)

Add "Team Chat" section or integrate chat links into player cards:

Option: Add a "Team Chats" section listing unique teams with chat links.

```html
<div class="bg-white rounded-2xl shadow-md p-6">
    <h2>Team Chats</h2>
    <!-- List of teams with chat links -->
    <a href="team-chat.html#teamId=${teamId}">
        ${teamName} Chat
    </a>
</div>
```

#### 2.3 Team Admin Banner (team-admin-banner.js)

Add "Chat" action card to the navigation grid:

```javascript
const hrefs = {
    public: `team.html#teamId=${teamId}`,
    team: `edit-team.html#teamId=${teamId}`,
    roster: `edit-roster.html#teamId=${teamId}`,
    schedule: `edit-schedule.html#teamId=${teamId}`,
    stats: `edit-config.html#teamId=${teamId}`,
    chat: `team-chat.html#teamId=${teamId}`,  // NEW
    exit: 'dashboard.html'
};
```

Grid changes from 6 columns to 7 (or wrap on smaller screens).

### 3. Chat Page (team-chat.html)

**URL:** `team-chat.html#teamId={teamId}`

**Layout:**
```
┌─────────────────────────────────────────┐
│ [Header with nav]                       │
├─────────────────────────────────────────┤
│ Team Admin Banner (with Chat active)    │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ [Load older messages...]            │ │
│ ├─────────────────────────────────────┤ │
│ │ ┌────┐ John Smith         10:30 AM  │ │
│ │ │ 🧑 │ Hey team, practice moved...  │ │
│ │ └────┘                              │ │
│ ├─────────────────────────────────────┤ │
│ │ ┌────┐ Jane Doe           10:32 AM  │ │
│ │ │ 👩 │ Got it, thanks!              │ │
│ │ └────┘                    [Edit][X] │ │
│ ├─────────────────────────────────────┤ │
│ │          (Your message)             │ │
│ │        Thanks for the update!       │ │
│ │ 10:35 AM              [Edit][Del]   │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ [Message input...        ] [Refresh] [Send] │
└─────────────────────────────────────────┘
```

**Message Bubble Styles:**
- Other users: Left-aligned, gray background
- Current user: Right-aligned, primary color background
- Deleted: Italic "Message removed" text, muted style

**Actions per message:**
- Own messages: Edit, Delete buttons
- Admin viewing others' messages: Delete button only
- Others' messages (non-admin): No actions

### 4. Data Model

#### 4.1 User Profile Extension

```javascript
// users/{uid}
{
    // Existing fields...
    email: "user@example.com",
    fullName: "John Smith",
    phone: "555-1234",
    // NEW
    photoUrl: "https://storage.googleapis.com/.../user-photos/123_photo.jpg"
}
```

#### 4.2 Chat Messages Collection

```javascript
// teams/{teamId}/chatMessages/{messageId}
{
    text: "Hey team, practice is moved to 5pm",
    senderId: "user_uid_123",
    senderName: "John Smith",           // Cached at send time
    senderEmail: "john@example.com",    // Fallback display
    senderPhotoUrl: "https://...",      // Cached at send time
    createdAt: Timestamp,
    editedAt: Timestamp | null,         // Set when edited
    deleted: boolean                    // true = soft deleted
}
```

**Indexes Required:**
- `teams/{teamId}/chatMessages` ordered by `createdAt` descending (for pagination)

### 5. Database Functions (js/db.js)

```javascript
// Profile photo upload
export async function uploadUserPhoto(file) {
    await ensureImageAuth();
    const path = `user-photos/${Date.now()}_${file.name}`;
    const storageRef = ref(imageStorage, path);
    const snapshot = await uploadBytes(storageRef, file);
    return await getDownloadURL(snapshot.ref);
}

// Chat functions
export async function getChatMessages(teamId, { limit = 50, startAfter = null } = {}) {
    const messagesRef = collection(db, 'teams', teamId, 'chatMessages');
    let q = query(messagesRef, orderBy('createdAt', 'desc'), limitQuery(limit));
    if (startAfter) {
        q = query(q, startAfterQuery(startAfter));
    }
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function postChatMessage(teamId, { text, senderId, senderName, senderEmail, senderPhotoUrl }) {
    const messagesRef = collection(db, 'teams', teamId, 'chatMessages');
    return await addDoc(messagesRef, {
        text,
        senderId,
        senderName,
        senderEmail,
        senderPhotoUrl: senderPhotoUrl || null,
        createdAt: Timestamp.now(),
        editedAt: null,
        deleted: false
    });
}

export async function editChatMessage(teamId, messageId, newText) {
    const messageRef = doc(db, 'teams', teamId, 'chatMessages', messageId);
    return await updateDoc(messageRef, {
        text: newText,
        editedAt: Timestamp.now()
    });
}

export async function deleteChatMessage(teamId, messageId) {
    const messageRef = doc(db, 'teams', teamId, 'chatMessages', messageId);
    return await updateDoc(messageRef, {
        deleted: true
    });
}
```

### 6. Access Control

#### 6.1 Helper Function (js/db.js or js/auth.js)

```javascript
export function canAccessTeamChat(user, team) {
    if (!user) return false;

    // Owner
    if (team.ownerId === user.uid) return true;

    // Admin (email in adminEmails)
    if (user.email && team.adminEmails?.map(e => e.toLowerCase()).includes(user.email.toLowerCase())) {
        return true;
    }

    // Global admin
    if (user.isAdmin) return true;

    // Parent (has parentOf entry for this team)
    if (user.parentOf?.some(p => p.teamId === team.id)) return true;

    return false;
}

export function canModerateChat(user, team) {
    // Same as owner/admin check, excludes parents
    if (!user) return false;
    if (team.ownerId === user.uid) return true;
    if (user.email && team.adminEmails?.map(e => e.toLowerCase()).includes(user.email.toLowerCase())) {
        return true;
    }
    if (user.isAdmin) return true;
    return false;
}
```

#### 6.2 Firestore Security Rules

Add to `firestore.rules` inside the teams match:

```javascript
// Helper for chat access (includes parents)
function canAccessChat(teamId) {
    let team = get(/databases/$(database)/documents/teams/$(teamId)).data;
    let user = get(/databases/$(database)/documents/users/$(request.auth.uid)).data;

    return isSignedIn() && (
        team.ownerId == request.auth.uid ||
        (request.auth.token.email != null &&
         request.auth.token.email.lower() in team.get('adminEmails', [])) ||
        isGlobalAdmin() ||
        user.get('parentOf', []).where(p, p.teamId == teamId).size() > 0
    );
}

// Chat messages subcollection
match /chatMessages/{messageId} {
    // Read: any team member (owner, admin, global admin, parent)
    allow read: if canAccessChat(teamId);

    // Create: any team member
    allow create: if canAccessChat(teamId) &&
                     request.resource.data.senderId == request.auth.uid;

    // Update (edit): only message sender
    allow update: if canAccessChat(teamId) &&
                     resource.data.senderId == request.auth.uid &&
                     request.resource.data.diff(resource.data).affectedKeys()
                         .hasOnly(['text', 'editedAt']);

    // Delete (soft): sender OR team owner/admin/global admin
    allow update: if canAccessChat(teamId) &&
                     request.resource.data.diff(resource.data).affectedKeys()
                         .hasOnly(['deleted']) &&
                     request.resource.data.deleted == true &&
                     (resource.data.senderId == request.auth.uid ||
                      isTeamOwnerOrAdmin(teamId));
}
```

### 7. UI Components Detail

#### 7.1 Message Component

```javascript
function renderMessage(msg, currentUser, canModerate) {
    const isOwn = msg.senderId === currentUser.uid;
    const isDeleted = msg.deleted === true;
    const displayName = msg.senderName || msg.senderEmail || 'Unknown';
    const timestamp = msg.createdAt?.toDate().toLocaleTimeString([], {
        hour: 'numeric', minute: '2-digit'
    });

    if (isDeleted) {
        return `<div class="message deleted">Message removed</div>`;
    }

    const avatar = msg.senderPhotoUrl
        ? `<img src="${escapeHtml(msg.senderPhotoUrl)}" class="w-10 h-10 rounded-full">`
        : `<div class="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center">
             <span class="text-sm font-bold">${escapeHtml(displayName.charAt(0))}</span>
           </div>`;

    const actions = [];
    if (isOwn) {
        actions.push(`<button onclick="editMessage('${msg.id}')">Edit</button>`);
        actions.push(`<button onclick="deleteMessage('${msg.id}')">Delete</button>`);
    } else if (canModerate) {
        actions.push(`<button onclick="deleteMessage('${msg.id}')">Delete</button>`);
    }

    const alignment = isOwn ? 'flex-row-reverse' : 'flex-row';
    const bubbleColor = isOwn ? 'bg-primary-100' : 'bg-gray-100';

    return `
        <div class="flex ${alignment} gap-3 mb-4">
            ${avatar}
            <div class="max-w-[70%]">
                <div class="text-xs text-gray-500 mb-1">
                    ${escapeHtml(displayName)}
                    ${msg.editedAt ? '<span class="italic">(edited)</span>' : ''}
                </div>
                <div class="${bubbleColor} rounded-lg px-4 py-2">
                    ${escapeHtml(msg.text)}
                </div>
                <div class="text-xs text-gray-400 mt-1 flex gap-2">
                    ${timestamp}
                    ${actions.join(' ')}
                </div>
            </div>
        </div>
    `;
}
```

#### 7.2 Composer Component

```html
<div class="sticky bottom-0 bg-white border-t p-4">
    <div class="flex gap-2">
        <input type="text" id="message-input"
               placeholder="Type a message..."
               class="flex-1 border rounded-lg px-4 py-2">
        <button id="refresh-btn" class="px-4 py-2 border rounded-lg">
            Refresh
        </button>
        <button id="send-btn" class="px-4 py-2 bg-primary-600 text-white rounded-lg">
            Send
        </button>
    </div>
</div>
```

### 8. Error Handling

| Scenario | Handling |
|----------|----------|
| User not authenticated | Redirect to login.html |
| User lacks team access | Show error, redirect to dashboard |
| Message send fails | Show error toast, keep text in input |
| Load messages fails | Show error with retry button |
| Edit/delete fails | Show error toast |

### 9. Testing Strategy

**Unit Tests (if applicable):**
- `canAccessTeamChat()` with various user/team combos
- `canModerateChat()` permissions
- Message rendering with all states

**Manual Testing Scenarios:**
1. Coach sends message, appears in list
2. Parent sends message, coach sees it
3. User edits own message, shows "edited"
4. User deletes own message, shows "Message removed"
5. Admin deletes another's message
6. Parent cannot delete coach's message
7. Unauthenticated user redirected from chat
8. User without team access redirected
9. Pagination: scroll up loads older messages
10. Profile photo appears in messages after upload

### 10. File Changes Summary

| File | Change |
|------|--------|
| `js/db.js` | Add `uploadUserPhoto`, chat CRUD functions, access helpers |
| `profile.html` | Add photo upload section |
| `dashboard.html` | Add Chat button to team cards |
| `parent-dashboard.html` | Add Team Chats section |
| `js/team-admin-banner.js` | Add Chat nav card |
| `team-chat.html` | NEW - Full chat page |
| `firestore.rules` | Add chatMessages subcollection rules |

### 11. Migration Notes

- No data migration required (additive feature)
- Existing users will have no photoUrl until they upload
- Chat collection created on first message per team
