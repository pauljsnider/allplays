# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ALL PLAYS is a sports team management and live stat tracking web application. It's a static HTML + JavaScript app using Firebase as the backend, hosted on GitHub Pages.

**Key Features:** Team management, roster management, live game stat tracking, game replays, team chat, parent dashboards, AI-powered game summaries.

## Tech Stack

- **Frontend:** HTML5, JavaScript (ES Modules), Tailwind CSS (CDN)
- **Backend:** Firebase (Auth, Firestore, Storage, Vertex AI/GenAI)
- **Hosting:** GitHub Pages (static)
- **No build step** - Direct ES module imports in browser

## Local Development

```bash
# Option 1: Python
python3 -m http.server 8000

# Option 2: Node
npx http-server .
```

Open `http://localhost:8000` in your browser.

## Testing

No automated test framework. Manual testing via HTML test pages:
```bash
python3 -m http.server 8004
# Visit: http://127.0.0.1:8004/test-pr-changes.html
```

Test pages: `test-foul-tracking.html`, `test-pr-changes.html`, `test-statsheet-mapping.html`

See `PR-TESTING-GUIDE.md` for critical flow testing and `FOUL-TRACKING-TEST-GUIDE.md` for foul scenarios.

## Architecture

### Module Structure (`js/`)
- `firebase.js` - Main Firebase app init (Auth, Firestore, Storage, GenAI)
- `firebase-images.js` - Separate Firebase project for image uploads (security isolation)
- `auth.js` - Authentication flows (email/password, Google OAuth)
- `db.js` - Firestore CRUD operations and helpers
- `utils.js` - UI utilities, date/time formatting
- `admin.js` - Admin dashboard functionality
- `team-admin-banner.js` - Team-level admin UI banner component
- `track-basketball.js` - Mobile basketball tracker (primary tracker)
- `live-tracker.js` - Live game monitoring
- `live-game.js` - Live game viewer and replay player
- `vendor/` - Firebase SDK bundles (ES Module format): app, auth, firestore, storage, ai

### Two Firebase Projects
1. **Main project** (`game-flow-c6311`): Auth, Firestore, business logic
2. **Image project** (`game-flow-img`): Anonymous auth + Storage for uploads

This separation provides defense-in-depth for image handling.

### Firebase Config Files
- `firebase.json` - Hosting config with cache headers (2hr images, 1hr JS/CSS) and SPA rewrite
- `firestore.rules` - Security rules implementing multi-level access control
- `firestore.indexes.json` - Composite indexes for game queries (by type/date, liveStatus/date)

### Tracker Routing
Games use a `statTrackerConfigId` to define sport + columns. Basketball games (config `baseType: Basketball`) prompt the user to choose between:
- **Standard** → `track.html` (all sports)
- **Beta** → `track-basketball.html` (basketball-optimized mobile tracker)

Non-basketball games always route to `track.html`.

### Data Model (Firestore)
```
/users/{userId}
/teams/{teamId}
  /players/{playerId}
  /games/{gameId}
    /events/{eventId}        # Raw stat events
    /aggregatedStats/{statId}
    /liveEvents/{eventId}    # Real-time broadcasting
    /liveChat/{messageId}    # Public game chat
    /liveReactions/{reactionId}
  /statTrackerConfigs/{configId}
  /chatMessages/{messageId}  # Team-level chat
/accessCodes/{codeId}        # Signup activation codes
```

Linked opponent fields on `games/{gameId}` (Phase 1):
- `opponentTeamId`, `opponentTeamName`, `opponentTeamPhoto`
- `opponentStats.*.playerId`, `opponentStats.*.photoUrl`

### Key Patterns
- ES6 modules with import/export
- Singleton Firebase instances shared across pages
- Real-time updates via `onSnapshot()` listeners
- Module-level state objects (e.g., `state` in track-basketball.js)
- Security enforced server-side via Firestore rules

### Access Control Hierarchy
1. **Global Admin:** `users/{uid}.isAdmin == true` - full access
2. **Team Owner:** `teams/{teamId}.ownerId` - owns the team
3. **Team Admin:** Listed in `teams/{teamId}.adminEmails[]`
4. **Parent:** Listed in `users/{uid}.parentTeamIds[]` - limited access

## Migration Scripts

The `_migration/` directory contains one-off Node.js scripts for data fixes and migrations (e.g., `migrate-parent-team-ids.js`, `fix-summary-field.js`, `delete-game.js`). These run against Firestore using a service account key. See `_migration/MIGRATION-README.md`.

## Spec-Driven Development

Feature specs live in `/spec/{feature_name}/` with `requirements.md`, `design.md`, and `tasks.md`.

Existing specs: `linked-opponent-teams`, `live-game-tracker`, `team-chat`, `parent-teams-dashboard-single-button`.

Use custom commands: `/spec-init`, `/spec-execute-task`, `/spec-update`

## Coding Conventions

1. **Indentation:** 4 spaces, semicolons, ES module imports
2. **Naming:** `camelCase` for variables/functions, DOM IDs consistent with HTML names
3. **Cache busting:** Query params on imports (e.g., `?v=8`)
4. **Activation codes:** Required for signup (no open registration)
5. **Public API keys:** Firebase keys are public; security is via Firestore rules
6. **Mobile-first:** Tracker pages optimized for phone screens
7. **Vanilla JS:** No React/Vue - direct DOM manipulation with querySelector

## Deployment

```bash
# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy hosting (if using Firebase Hosting)
firebase deploy --only hosting
```

GitHub Pages: Push to master branch, enable Pages in repo settings.
