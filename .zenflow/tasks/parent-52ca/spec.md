# Technical Specification: Parent Role & Dashboard

## 1. Technical Context
- **Frontend**: HTML5, Tailwind CSS, Vanilla JS (ES Modules).
- **Backend**: Firebase Firestore (NoSQL), Firebase Auth.
- **Hosting**: Firebase Hosting.
- **Current State**: Single-role (Coach/Admin) system. `player.html` is read-only.

## 2. Data Model Changes

### 2.1 Users Collection (`users/{uid}`)
```javascript
{
  "email": "string",
  "displayName": "string",
  "photoUrl": "string",
  "isAdmin": boolean, // Global admin
  "coachOf": ["teamId1", "teamId2"], // NEW: Array of Team IDs owned/coached
  "parentOf": [ // NEW: Array of Player links
    {
      "teamId": "string",
      "playerId": "string",
      "playerName": "string", // Cached for display
      "teamName": "string",   // Cached for display
      "playerPhotoUrl": "string" // Cached (optional, might get stale)
    }
  ],
  "roles": ["coach", "parent"] // Derived/Helper
}
```

### 2.2 Players Subcollection (`teams/{teamId}/players/{playerId}`)
```javascript
{
  "name": "string",
  "number": "string",
  "photoUrl": "string",
  "position": "string",
  // ... existing fields ...
  "parents": [ // NEW
    {
      "userId": "uid_string",
      "email": "string",
      "relation": "string", // e.g. "Mother"
      "status": "active" // or "pending"
    }
  ],
  "emergencyContact": { // NEW: Editable by parent
    "name": "string",
    "phone": "string",
    "relation": "string"
  },
  "medicalInfo": "string" // NEW: Editable by parent
}
```

### 2.3 Access Codes (`accessCodes/{codeId}`)
```javascript
{
  "code": "string", // The actual code (indexed)
  "type": "parent_invite",
  "teamId": "string",
  "playerId": "string",
  "createdBy": "uid_string",
  "createdAt": timestamp,
  "expiresAt": timestamp,
  "usedBy": "uid_string" // or null
}
```

## 3. Implementation Approach

### 3.1 Authentication & Role Management (`js/auth.js`)
- **`checkAuth`**:
    - Fetch user profile.
    - Attach `user.parentOf` and `user.coachOf` to the returned user object.
    - **Routing**:
        - If `window.location` is `login.html`:
            - If `coachOf.length > 0` -> `dashboard.html`
            - Else if `parentOf.length > 0` -> `parent-dashboard.html`
            - Else -> `dashboard.html` (New user flow)

### 3.2 Database Layer (`js/db.js`)
- **`inviteParent(teamId, playerId, relation)`**:
    - Generate unique 6-char code.
    - Write to `accessCodes`.
- **`redeemAccessCode(code)`**:
    - Validate code.
    - Transaction:
        - Update `users/{uid}`: push to `parentOf`.
        - Update `teams/{teamId}/players/{playerId}`: push to `parents`.
        - Mark code used.
- **`getParentDashboardData(userId)`**:
    - Fetch user profile to get `parentOf`.
    - `Promise.all`:
        - Fetch `teams/{teamId}` for each link.
        - Fetch `teams/{teamId}/games` (query upcoming).
        - Fetch `teams/{teamId}/players/{playerId}` (recent stats).
    - Return aggregated object: `{ upcomingGames: [], children: [] }`.

### 3.3 UI Architecture

#### 3.3.1 Parent Dashboard (`parent-dashboard.html`)
- **Layout**:
    - **Header**: Standard, but with links appropriate for parent.
    - **Section 1: Upcoming Schedule**:
        - Combined list of games from all linked teams.
        - Sorted by `date` ascending.
        - Cards showing: Date, Time, Team (Child Name) vs Opponent, Location.
    - **Section 2: My Players**:
        - Cards for each child.
        - Show: Photo, Name, Team Name, Recent Stats Summary.
        - Click -> `player.html`.

#### 3.3.2 Player Profile (`player.html`)
- **Edit Mode**:
    - Check if `currentUser.uid` is in `player.parents` OR `currentUser.isAdmin` OR `currentUser.uid` == `team.owner`.
    - If Parent (and not Coach):
        - Show "Edit Profile" button near photo.
        - **Modal**: "Edit Player Details"
            - Inputs: Photo Upload, Emergency Contact Name/Phone, Medical Info.
            - **ReadOnly**: Name, Number, Position (Display notice: "Ask coach to change").
    - If Coach:
        - Full edit access (existing behavior).

#### 3.3.3 Roster Management (`edit-roster.html`)
- Add "Invite Parent" button next to each player.
- Modal to generate/copy code.

## 4. Security Rules (`firestore.rules`)
```
match /teams/{teamId}/players/{playerId} {
  allow read: if true; // Public read (or restricted to team scope if stricter)
  allow update: if 
    // Coach/Admin
    isTeamAdmin(teamId) || 
    // Parent (Restricted fields)
    (request.auth.uid in resource.data.parents.map(p => p.userId) && 
     request.resource.data.diff(resource.data).affectedKeys().hasOnly(['photoUrl', 'emergencyContact', 'medicalInfo']));
}
```

## 5. Verification Plan
- **Lint**: `npm run lint` (if available, otherwise check console).
- **Manual Tests**:
    1.  **Coach Flow**: Login as Coach -> Invite Parent -> Copy Code.
    2.  **Parent Flow**: Incognito -> Signup with Code -> Verify `parent-dashboard`.
    3.  **Schedule**: Add games to 2 different teams -> Verify dashboard shows both.
    4.  **Edit**: As Parent -> Change Photo -> Verify persistence. Try to change Number (should fail/be disabled).
