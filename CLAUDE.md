# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ALL PLAYS is a sports team management and live stat tracking product. The legacy website is static HTML + JavaScript using Firebase as the backend. The new ALL PLAYS app is a React/TypeScript + Capacitor app in `apps/app`, hosted on the website at `/app/` and packaged for iOS/Android.

**Key Features:** Team management, roster management, live game stat tracking, game replays, team chat, parent dashboards, AI-powered game summaries.

## Tech Stack

- **Legacy frontend:** HTML5, JavaScript (ES Modules), Tailwind CSS (CDN)
- **App frontend:** React, TypeScript, Vite, Tailwind, Capacitor
- **Backend:** Firebase (Auth, Firestore, Storage, Vertex AI/GenAI)
- **Hosting:** GitHub Pages for `allplays.ai`; Firebase Hosting preview channels for PRs
- **Native:** Capacitor iOS and Android projects in `ios/` and `android/`

## Local Development

```bash
# Legacy static site
python3 -m http.server 8000

# Legacy static site alternative
npx http-server .

# React/Capacitor app
npm run app:dev
npm run app:build

# Native sync/build checks
npm run mobile:sync
npm run mobile:build:ios
npm run mobile:build:android
```

Open legacy pages at `http://localhost:8000`. Open the React app at `http://localhost:5174`.

## Testing

Two automated test tiers — both must stay green:

```bash
# Unit tests (Vitest) — fast, no server needed
npm test

# Smoke / E2E tests (Playwright) — requires a running server
npm run test:smoke
```

### Unit tests — `tests/unit/`
Read HTML and JS files via `readFileSync`; mock Firebase with `vi.fn()`. Cover:
- JS module logic and error branches
- HTML page structure, `data-*` attributes, element IDs
- Internal link targets (assert referenced `.html` files exist)
- Inline JS wiring (assert key function names and logic are present)

Run one file: `npx vitest run tests/unit/my-feature.test.js --reporter=verbose`

### Smoke tests — `tests/smoke/`
Playwright tests against a live static server. Cover page boot, interactive flows (search, filters, modals), and navigation. Use `assertPageBootsWithoutFatalErrors` from `helpers/boot-path.js`; register new public pages in `page-registry.js`.

### What to write
- **New JS module** → unit test for exported functions.
- **New React app helper** → unit test in `tests/unit/` and focused app smoke coverage when it changes a route or user flow.
- **New static page** → unit test (structure + JS wiring) + smoke spec (boot + interactions).
- **Bug fix** → regression unit test that fails before the fix.

### Manual test pages (legacy)
`test-foul-tracking.html`, `test-pr-changes.html`, `test-statsheet-mapping.html` remain valid for quick visual checks. See `PR-TESTING-GUIDE.md` and `FOUL-TRACKING-TEST-GUIDE.md` for critical flows not yet automated.

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
- `drill-constants.js` - Practice drill library data (categories, skill levels)
- `global-search.js` - Cross-entity search functionality
- `vendor/` - Firebase SDK bundles (ES Module format): app, auth, firestore, storage, ai

### React/Capacitor App (`apps/app/`)
- `src/pages/` - App routes for auth, home, schedule, messages, teams, player details, profile, private AI, and parent tools
- `src/components/` - Shared app shell, navigation, cards, and form UI
- `src/lib/` - Shared app data services, Firebase adapters, native adapters, and feature helpers
- `vite.config.ts` - Uses `base: './'` so the production build works under `/app/`
- `capacitor.config.json` - Uses `apps/app/dist` as the native WebView bundle

Keep app feature logic shared across web/iOS/Android. Use thin Capacitor adapters for native auth, push, share, media, and dictation behavior.

Build hygiene: `npm run app:build` writes `apps/app/bundle-visualizer.html`; open it after build to inspect large modules and shared chunks. `npm run app:check-bundle-size` enforces the app entry chunk budget used by CI.

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
    /private/profile         # Sensitive fields (medical, contacts) - restricted access
  /games/{gameId}
    /events/{eventId}        # Raw stat events
    /aggregatedStats/{statId}
    /liveEvents/{eventId}    # Real-time broadcasting
    /liveChat/{messageId}    # Public game chat
    /liveReactions/{reactionId}
  /statTrackerConfigs/{configId}
  /chatMessages/{messageId}  # Team-level chat
  /practiceSessions/{sessionId}
    /attendance/{playerId}
    /packets/{packetId}
      /completions/{odp}     # Parent-submitted drill completions
  /drills/{drillId}          # Custom team drills
/drills/{drillId}            # Community drill library
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

The `_migration/` directory contains one-off Node.js scripts for data fixes and migrations (e.g., `migrate-parent-team-ids.js`, `fix-summary-field.js`, `delete-game.js`). These run against Firestore using a service account key (`firebase-admin` SDK). Requires Node.js 18+. See `_migration/MIGRATION-README.md`.

## Spec-Driven Development

Feature specs live in `/spec/{feature_name}/` with `requirements.md`, `design.md`, and `tasks.md`.

Existing specs: `linked-opponent-teams`, `live-game-tracker`, `team-chat`, `parent-teams-dashboard-single-button`, `practice-drills`.

Use custom commands: `/spec-init`, `/spec-execute-task`, `/spec-update`

## Commit and PR Guidelines

See `AGENTS.md` for commit message style (short, imperative, sentence-case) and PR requirements (bullet summary, manual test steps, screenshots for UI changes).

## Coding Conventions

1. **Indentation:** 4 spaces, semicolons, ES module imports
2. **Naming:** `camelCase` for variables/functions, DOM IDs consistent with HTML names
3. **Cache busting:** Query params on imports (e.g., `?v=8`)
4. **Activation codes:** Required for signup (no open registration)
5. **Public API keys:** Firebase keys are public; security is via Firestore rules
6. **Mobile-first:** Tracker pages optimized for phone screens
7. **Legacy pages:** Use vanilla JS and direct DOM manipulation
8. **React app:** Follow the existing `apps/app` component and helper patterns; avoid forking feature logic by platform

## Deployment

```bash
# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy hosting (if using Firebase Hosting)
firebase deploy --only hosting
```

GitHub Pages: `.github/workflows/app-github-pages.yml` stages the legacy root site plus the React app under `/app/` with `scripts/stage-pages-bundle.mjs`.

Firebase previews: `.github/workflows/deploy-preview.yml` deploys a staged preview bundle so PR preview URLs include `/app/`.

Production smoke: `post-deploy-smoke` and `scheduled-prod-smoke` check the legacy site plus the deployed `/app/` boot route.
