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

Manual testing via HTML test pages:
```bash
python3 -m http.server 8004
# Visit: http://127.0.0.1:8004/test-pr-changes.html
```

Test pages: `test-foul-tracking.html`, `test-pr-changes.html`, `test-statsheet-mapping.html`

No automated test framework.

## Architecture

### Module Structure (`js/`)
- `firebase.js` - Main Firebase app init (Auth, Firestore, Storage, GenAI)
- `firebase-images.js` - Separate Firebase project for image uploads (security isolation)
- `auth.js` - Authentication flows (email/password, Google OAuth)
- `db.js` - Firestore CRUD operations and helpers
- `utils.js` - UI utilities, date/time formatting
- `track-basketball.js` - Mobile basketball tracker (primary tracker)
- `live-tracker.js` - Live game monitoring
- `live-game.js` - Live game viewer and replay player
- `vendor/` - Firebase SDK bundles (ES Module format)

### Two Firebase Projects
1. **Main project** (`game-flow-c6311`): Auth, Firestore, business logic
2. **Image project** (`game-flow-img`): Anonymous auth + Storage for uploads

This separation provides defense-in-depth for image handling.

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

## Key Pages

| Page | Purpose |
|------|---------|
| `track-basketball.html` | Mobile-first basketball tracker (PRIMARY) |
| `live-game.html` | Live game viewer + replay |
| `edit-schedule.html` | Manage games, triggers tracker selection |
| `team-chat.html` | Team communication |
| `admin.html` | Admin dashboard (requires isAdmin flag) |

## Spec-Driven Development

This project follows spec-driven development. Feature specs live in `/spec/{feature_name}/`:
- `requirements.md` - User stories and EARS requirements
- `design.md` - Architecture, components, data models
- `tasks.md` - Implementation checklist

Use custom commands: `/spec-init`, `/spec-execute-task`, `/spec-update`

## Important Conventions

1. **Cache busting:** Query params on imports (e.g., `?v=8`)
2. **Activation codes:** Required for signup (no open registration)
3. **Public API keys:** Firebase keys are public; security is via Firestore rules
4. **Mobile-first:** Tracker pages optimized for phone screens
5. **Vanilla JS:** No React/Vue - direct DOM manipulation with querySelector

## Deployment

Firebase configuration:
```bash
# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy hosting (if using Firebase Hosting)
firebase deploy --only hosting
```

GitHub Pages: Push to main/master branch, enable Pages in repo settings.
