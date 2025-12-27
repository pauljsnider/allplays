# Parent Role Requirements

## 1. Overview
The "Parent Role" feature allows parents to sign up, link to their child's player profile, and view team information (schedule, game stats, roster) without having edit permissions. This separates "Coach" (admin/write) access from "Parent" (read-only) access.

## 2. User Stories
- **As a Coach**, I want to invite parents to my team by entering their email for a specific player.
- **As a Parent**, I want to sign up/login and see a dashboard with a **combined schedule** for all my children across different teams.
- **As a Parent**, I want to **edit my child's profile photo and contact info** but not their stats or jersey number (unless allowed).
- **As a User (Coach & Parent)**, I want to access both my coaching tools and my parent dashboard from a single account without logging out.
- **As a Parent**, I want to view the full team roster and game details in a read-only mode.

## 3. Functional Requirements

### 3.1 Data Model Changes
- **`users/{uid}`**:
    - Add `roles`: Array `['parent', 'coach', 'admin']` (optional, for high-level UI logic).
    - Add `parentOf`: Array of objects `[{ teamId, playerId, playerName, teamName }]`.
    - Add `coachOf`: Array of strings `[teamId]` (to explicitly track owned teams).
    - Maintain `isAdmin`.
- **`teams/{teamId}/players/{playerId}`**:
    - Add `parents`: Array of objects `[{ userId, email, relation, status }]`.
    - **Permissions**: Parents listed here can write to specific fields (`photoUrl`, `contactInfo`) of this document.
- **`accessCodes/{id}`**:
    - (Unchanged from previous draft)

### 3.2 Authentication & Onboarding
- **Unified Login**: One account can have `parentOf` and `coachOf` data.
- **Redirect Logic**:
    - If `coachOf.length > 0` AND `parentOf.length > 0`: Go to a **Unified Dashboard** (or default to Coach view with a toggle).
    - If only `parentOf`: Go to `parent-dashboard.html`.
    - If only `coachOf` (or empty): Go to standard `dashboard.html`.

### 3.3 Dashboard & Navigation
- **Parent Dashboard (`parent-dashboard.html`)**:
    - **Combined Schedule**: Query games for all teams in `parentOf`. Merge and sort by date.
    - **My Players**: List of children. Click to view specific stats/team.
- **Player Details (Edit Mode)**:
    - On `player.html` (or a new `edit-player-profile.html`), if `currentUser.uid` is in `player.parents`:
        - Allow editing `photoUrl`.
        - Allow editing `emergencyContact`, `medicalInfo` (if added).
        - **Restrict** editing `number`, `position`, `stats`.
- **Header**:
    - If User has mixed roles, show a "Switch View" or simply link both "My Teams" and "My Kids".

### 3.4 Security Rules (Firestore)
- **Players**:
    - `update`: Allow if `request.auth.uid` is in `resource.data.parents` (for specific fields only: `photoUrl`, `details`) OR if user is Coach/Admin.

- **Games/Events/Stats**: Public read. Write only by Owner/Admin.
- **Access Codes**:
    - Create: Authenticated users (Coaches).
    - Read: Public (needed for validation before sign-in).
    - Update: Only by system (marking used) or creator.

### 4. Technical Components

### 4.1 `js/db.js` API Additions
- `addParentInvite(teamId, playerId, parentEmail, relation)`
- `linkParentToPlayer(userId, accessCodeData)`
- `getParentDashboardData(userId)`
- `updatePlayerProfile(teamId, playerId, data)`: Restricted update for parents (photo, contact).

### 4.2 `js/auth.js` Updates
- `checkAuth` callback should return `user` object with `roles` property populated from Firestore profile.
- Redirect logic: `login.html` redirects based on role (Unified vs Parent vs Coach).

### 4.3 UI Components
- **Invite Modal**: In `edit-roster.html`.
- **Parent Dashboard**: New HTML/JS file.
- **Player Edit Form**: Modal or page to edit permitted fields.



## 5. Migration Strategy
- Existing users are assumed to be Coaches.
- A migration script (or lazy migration on login) can set `roles: ['coach']` for users without a `roles` field.
- `isAdmin: true` users get `roles: ['admin', 'coach']`.

## 6. Testing Plan
1. **Coach Invite**: Verify coach can generate a code linked to a specific player.
2. **Parent Signup**: Verify new user gets `parent` role and `parentOf` data.
3. **Permissions**: Verify parent cannot see "Edit" buttons on Team/Player pages (except their own child's photo/contact).
4. **Data Integrity**: Verify player doc shows parent in `parents` array.
5. **Security**: Verify parent cannot write to `teams` collection via console, but CAN update `photoUrl` for their child.
6. **Combined Schedule**: Verify dashboard shows games from multiple teams if parent has >1 child.
