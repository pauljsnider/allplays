# Parent Role Requirements

## 1. Overview
The "Parent Role" feature allows parents to sign up, link to their child's player profile, and view team information (schedule, game stats, roster) without having edit permissions. This separates "Coach" (admin/write) access from "Parent" (read-only) access.

## 2. User Stories
- **As a Coach**, I want to invite parents to my team by entering their email for a specific player, so they can access the team info.
- **As a Parent**, I want to sign up using an invite code so that I am automatically linked to my child's profile.
- **As a Parent**, I want to log in and see a "My Player" dashboard showing my child's team, schedule, and stats.
- **As a Parent**, I want to view the full team roster and game details but NOT see any "Edit", "Delete", or "Add" buttons.
- **As a System**, I want to prevent parents from modifying team data in the database, even if they try to access the API directly.

## 3. Functional Requirements

### 3.1 Data Model Changes
- **`users/{uid}`**:
    - Add `roles`: Array of strings, e.g., `['parent']`, `['coach']`, `['admin']`.
    - Add `parentOf`: Array of objects `[{ teamId, playerId, playerName, teamName }]` for quick dashboard access.
    - Maintain `isAdmin` for global admins (backward compatibility).
- **`teams/{teamId}/players/{playerId}`**:
    - Add `parents`: Array of objects `[{ userId, email, relation, status: 'pending'|'active', addedBy }]`.
- **`accessCodes/{id}`**:
    - Add `role`: String `'coach' | 'parent'`.
    - Add `teamId`: String (ID of the team).
    - Add `playerId`: String (ID of the player).
    - Add `playerName`: String (Name of the player).
    - Add `expiresAt`: Timestamp (Optional, for future expiry).

### 3.2 Authentication & Onboarding
- **Coach Invite Flow**:
    - In `edit-roster.html`, coaches can click "Invite Parent" for a player.
    - Coach enters parent's email (optional) and relation (e.g., "Mother", "Father").
    - System generates an Access Code with `role: 'parent'`, `teamId`, and `playerId`.
    - Coach shares the code with the parent.
- **Parent Signup Flow**:
    - Parent goes to `login.html#signup`.
    - Enters valid Access Code.
    - System validates code and detects `role: 'parent'`.
    - On account creation:
        - User `roles` set to `['parent']`.
        - User `parentOf` updated with team/player info.
        - Player's `parents` list updated (status 'active').
        - Access code marked as used.
    - Redirect to `parent-dashboard.html` (or `dashboard.html` with parent view).

### 3.3 Dashboard & Navigation
- **Navigation (Header)**:
    - If user has only `parent` role:
        - "Create Team" CTA is hidden.
        - "My Teams" link points to Parent Dashboard.
- **Parent Dashboard (`parent-dashboard.html`)**:
    - Lists linked players/teams.
    - Shows "Upcoming Games" for linked teams.
    - Shows recent game stats/recaps.
    - Quick links to `team.html` (read-only view).
- **Existing Pages (`team.html`, `player.html`, `game.html`)**:
    - Logic to hide "Edit" buttons if user is not the owner/admin.
    - Ensure data fetching works for parents (security rules allow read).

### 3.4 Security Rules (Firestore)
- **Users**: Read/Write own profile.
- **Teams**: Public read. Write only by Owner/Admin.
- **Players**: Read by public. Write only by Owner/Admin.
    - *Refinement*: `parents` field on player doc only writable by Owner/Admin (parents can't remove other parents).
- **Games/Events/Stats**: Public read. Write only by Owner/Admin.
- **Access Codes**:
    - Create: Authenticated users (Coaches).
    - Read: Public (needed for validation before sign-in).
    - Update: Only by system (marking used) or creator.

## 4. Technical Components

### 4.1 `js/db.js` API Additions
- `addParentInvite(teamId, playerId, parentEmail, relation)`
- `linkParentToPlayer(userId, accessCodeData)`
- `getParentDashboardData(userId)`

### 4.2 `js/auth.js` Updates
- `checkAuth` callback should return `user` object with `roles` property populated from Firestore profile.
- Redirect logic: `login.html` redirects parents to `parent-dashboard.html`.

### 4.3 UI Components
- **Invite Modal**: In `edit-roster.html`.
- **Parent Dashboard**: New HTML/JS file.
- **Read-Only Mode**: Utility function or CSS class to hide `.admin-only` elements based on user role.

## 5. Migration Strategy
- Existing users are assumed to be Coaches.
- A migration script (or lazy migration on login) can set `roles: ['coach']` for users without a `roles` field.
- `isAdmin: true` users get `roles: ['admin', 'coach']`.

## 6. Testing Plan
1. **Coach Invite**: Verify coach can generate a code linked to a specific player.
2. **Parent Signup**: Verify new user gets `parent` role and `parentOf` data.
3. **Permissions**: Verify parent cannot see "Edit" buttons on Team/Player pages.
4. **Data Integrity**: Verify player doc shows parent in `parents` array.
5. **Security**: Verify parent cannot write to `teams` collection via console.
