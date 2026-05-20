# /goal — ALL PLAYS: Web → React/Vite + Capacitor Migration

## Objective
Migrate the ALL PLAYS sports team management web app from static HTML + vanilla JS into a single React/Vite SPA packaged with Capacitor for iOS and Android. Preserve 100% of existing functionality. Do not delete the original HTML files until each feature is verified working in React.

## Source Repository
Working directory: current repo root. Original pages are `.html` files. Original logic is in `js/`. Firebase config is in `firebase.js` and `firebase-images.js`.

## Target Architecture
- **Framework:** React 18 + Vite
- **Routing:** React Router v6 (hash router for Capacitor compatibility)
- **Styling:** Tailwind CSS v3 (npm, not CDN)
- **State:** Zustand for global/game state, React Context for auth
- **Backend:** Firebase Web SDK v10 (keep existing config — do not change Firebase projects)
- **Mobile:** Capacitor v6 (`@capacitor/core`, `@capacitor/ios`, `@capacitor/android`)
- **Output:** `src/` directory for all React source; `dist/` for Vite build; `ios/` and `android/` for Capacitor

## Firebase Rules
- Do NOT modify `firestore.rules`, `storage.rules`, or `firestore.indexes.json`
- Do NOT change Firebase project IDs (`game-flow-c6311`, `game-flow-img`)
- Reuse the existing Firebase singleton pattern from `js/firebase.js` and `js/firebase-images.js` — wrap them as `src/lib/firebase.ts` and `src/lib/firebase-images.ts`

## Coding Rules
- TypeScript preferred for new files (`.tsx` / `.ts`). Plain `.jsx` acceptable for direct ports
- 4-space indentation, semicolons
- No comments unless the WHY is non-obvious
- Mobile-first: all tracker/game-day pages must work on a 390px wide screen
- Each route must lazy-load via `React.lazy()` to keep initial bundle small
- Real-time Firestore: use `useEffect` + `onSnapshot` cleanup pattern

## Progress Tracking
After completing each task below:
1. Mark it `[x]` in this file
2. Commit with message: `migrate: <task name>`
3. Move to the next `[ ]` task

If a task fails after 3 attempts, mark it `[~]` (blocked), write a one-line note explaining why, and skip to the next task.

---

## PHASE 0 — Scaffold & Capacitor Shell
- [ ] 0.1 — Initialize React/Vite app in `src/` with TypeScript template; update existing `vite.config.js` to point at `src/main.tsx` as entry; install Tailwind CSS, React Router v6, Zustand, Firebase npm package
- [ ] 0.2 — Create `src/main.tsx` with HashRouter, a root `<App />` component, and a placeholder home route that renders "ALL PLAYS"
- [ ] 0.3 — Install Capacitor (`@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`); run `npx cap init`; add `npx cap sync` to package.json scripts
- [ ] 0.4 — Wire Vite `outDir` to `www/` (Capacitor's default web dir); confirm `npx cap sync` runs without errors
- [ ] 0.5 — Create `src/lib/firebase.ts` wrapping the existing Firebase singleton (Auth, Firestore, Storage, GenAI) from `js/firebase.js`
- [ ] 0.6 — Create `src/lib/firebase-images.ts` wrapping `js/firebase-images.js` (image-upload Firebase project)
- [ ] 0.7 — Create `src/hooks/useAuth.ts` — a React context + hook exposing `user`, `loading`, `signIn`, `signOut`, `signInWithGoogle`; port logic from `js/auth.js`

---

## PHASE 1 — Auth & Shell Layout
- [ ] 1.1 — Create `src/pages/Login.tsx` — port `login.html` + `js/login-page.js`; email/password + Google OAuth + activation code validation (`js/access-code-utils.js`)
- [ ] 1.2 — Create `src/pages/ResetPassword.tsx` — port `reset-password.html`
- [ ] 1.3 — Create `src/pages/VerifyPending.tsx` — port `verify-pending.html`
- [ ] 1.4 — Create `src/components/PrivateRoute.tsx` — redirects to `/login` if no authenticated user
- [ ] 1.5 — Create `src/components/AppShell.tsx` — persistent bottom tab bar (Home, Schedule, Chat, Team, Profile) shown on all authenticated pages; renders `<Outlet />` for nested routes; mobile-safe-area aware
- [ ] 1.6 — Create `src/pages/Profile.tsx` — port `profile.html`
- [ ] 1.7 — Wire all Phase 1 routes into `src/App.tsx` with lazy loading

---

## PHASE 2 — Team & Roster Management
- [ ] 2.1 — Create `src/pages/Teams.tsx` — port `teams.html` (browse/search teams)
- [ ] 2.2 — Create `src/pages/Team.tsx` — port `team.html` (team detail view)
- [ ] 2.3 — Create `src/pages/EditTeam.tsx` — port `edit-team.html` + admin banner (`js/team-admin-banner.js`)
- [ ] 2.4 — Create `src/pages/EditRoster.tsx` — port `edit-roster.html` + `js/edit-roster-registration-import.js`
- [ ] 2.5 — Create `src/pages/Player.tsx` — port `player.html` + `js/player-profile-stats.js`
- [ ] 2.6 — Create `src/pages/AthleteProfile.tsx` — port `athlete-profile.html` + `js/athlete-profile-utils.js`
- [ ] 2.7 — Create `src/pages/AthleteProfileBuilder.tsx` — port `athlete-profile-builder.html`
- [ ] 2.8 — Create `src/pages/PlayerProfileStats.tsx` — port `player-profile-stats.html`
- [ ] 2.9 — Create `src/pages/TeamPass.tsx` — port `team-pass.html`

---

## PHASE 3 — Schedule & Calendar
- [ ] 3.1 — Create `src/pages/EditSchedule.tsx` — port `edit-schedule.html` and all `js/edit-schedule-*.js` modules (cancellation, practice payload, CSV import, season record)
- [ ] 3.2 — Create `src/pages/Calendar.tsx` — port `calendar.html` + `js/calendar-rsvp.js` + `js/calendar-ics-sync.js`
- [ ] 3.3 — Create `src/pages/OrganizationSchedule.tsx` — port `organization-schedule.html`
- [ ] 3.4 — Create `src/pages/GamePlan.tsx` — port `game-plan.html` + `js/game-plan-autosave.js` + `js/game-plan-interop.js`
- [ ] 3.5 — Port RSVP logic into `src/hooks/useRsvp.ts` covering: `js/rsvp-doc-ids.js`, `js/rsvp-hydration.js`, `js/rsvp-summary.js`, `js/availability-preferences.js`, `js/availability-cutoff-date.js`

---

## PHASE 4 — Parent Dashboard & Family Features
- [ ] 4.1 — Create `src/pages/ParentDashboard.tsx` — port `parent-dashboard.html` + all `js/parent-dashboard-*.js` modules (RSVP, fees, packets, practice sessions, rideshare)
- [ ] 4.2 — Create `src/pages/PublicRsvp.tsx` — port `public-rsvp.html` (no login required; public route)
- [ ] 4.3 — Create `src/pages/RideshareHelpers.tsx` — port `rideshare-helpers.html`
- [ ] 4.4 — Port `js/family-plan.js` into `src/hooks/useFamilyPlan.ts`

---

## PHASE 5 — Team Communication & Media
- [ ] 5.1 — Create `src/pages/TeamChat.tsx` — port `team-chat.html` + `js/team-chat-conversations.js` + `js/team-chat-last-read.js` + `js/team-chat-media.js`; use `onSnapshot` for real-time messages
- [ ] 5.2 — Create `src/pages/TeamMedia.tsx` — port `team-media.html` + `js/team-media.js` + `js/team-media-utils.js`
- [ ] 5.3 — Create `src/pages/TeamFees.tsx` — port `team-fees.html` + `js/team-fees-admin.js` + `js/parent-dashboard-fees.js`
- [ ] 5.4 — Port push notification setup into `src/lib/pushNotifications.ts` from `js/push-notifications.js` + `js/notification-preferences.js`

---

## PHASE 6 — Game History, Reports & AI Summaries
- [ ] 6.1 — Create `src/pages/Game.tsx` — port `game.html` + `js/game-report-stats.js` + `js/post-game-stat-editor.js`
- [ ] 6.2 — Create `src/pages/GameClips.tsx` — port `game-clips.html` + `js/game-clips.js`
- [ ] 6.3 — Port AI summary into `src/hooks/useAiSummary.ts` from `js/track-ai-summary.js` + `js/post-game-insights.js`
- [ ] 6.4 — Create `src/pages/StatLeaderboards.tsx` — port `js/stat-leaderboards.js`

---

## PHASE 7 — Practice Drills
- [ ] 7.1 — Port drill constants into `src/data/drills.ts` from `js/drill-constants.js`
- [ ] 7.2 — Create drill management pages sourcing from spec at `spec/practice-drills/` — requirements, design, and tasks docs define the full feature

---

## PHASE 8 — Awards & Certificates
- [ ] 8.1 — Create `src/pages/Certificates.tsx` and `src/features/certificates/` directory; port all `js/certificates/*.js` modules (templates, renderer, exporter, assets, signers, aiDescriptions, studio)
- [ ] 8.2 — Verify PDF/image export works in a browser build (html-to-image vendor lib at `js/vendor/html-to-image/` must be npm-installed, not vendored)

---

## PHASE 9 — Admin & Officiating
- [ ] 9.1 — Create `src/pages/Admin.tsx` — port `admin.html` + `js/admin.js`; wrap in admin-only guard
- [ ] 9.2 — Create `src/pages/EditConfig.tsx` — port `edit-config.html` + `js/edit-config-access.js`
- [ ] 9.3 — Create `src/pages/Officials.tsx` — port `officials.html` + `js/officiating-slots.js` + `js/officiating-utils.js` + `js/officiating-notifications.js`
- [ ] 9.4 — Create `src/pages/TrackingItems.tsx` — port `tracking-items.html` + `js/tracking-items-admin.js`

---

## PHASE 10 — Standings & Tournaments
- [ ] 10.1 — Create `src/pages/LeagueStandings.tsx` — port `js/league-standings.js` + `js/native-standings.js`
- [ ] 10.2 — Create `src/pages/TournamentBrackets.tsx` — port `tournament-brackets.js` + `js/bracket-management.js` + `js/tournament-standings.js`

---

## PHASE 11 — Live Game Viewer & Replay
- [ ] 11.1 — Create `src/pages/LiveGame.tsx` — port `live-game.html` + `js/live-game.js` + `js/live-game-state.js`; use `onSnapshot` for real-time events
- [ ] 11.2 — Port live game sub-features into separate hooks: `js/live-game-chat.js` → `useGameChat.ts`, `js/live-game-video.js` → `useGameVideo.ts`, `js/live-game-replay.js` → `useGameReplay.ts`, `js/live-game-announcer.js` → `useAnnouncer.ts`
- [ ] 11.3 — Create `src/pages/LiveTracker.tsx` (coordinator page) — port `live-tracker.html` + `js/live-tracker.js`; this page routes users to the correct tracker based on sport config (`statTrackerConfigId`)
- [ ] 11.4 — Port live tracker sub-modules into hooks: `js/live-tracker-queue.js`, `js/live-tracker-lineup.js`, `js/live-tracker-notes.js`, `js/live-tracker-field-status.js`, `js/live-tracker-finish.js`, `js/live-tracker-resume.js`, `js/live-tracker-integrity.js`, `js/live-tracker-opponent-stats.js`

---

## PHASE 12 — Live Game Tracker: Basketball (Most Complex — Do Last)
- [ ] 12.1 — Create a Zustand store `src/stores/basketballGameStore.ts` — model all state from `js/track-basketball.js`'s module-level `state` object; expose actions as Zustand actions
- [ ] 12.2 — Create `src/pages/TrackBasketball.tsx` — port `track-basketball.html` + `js/track-basketball.js` using the Zustand store; stat buttons must be touchable with no delay (use `onPointerDown`, not `onClick`)
- [ ] 12.3 — Port sport-specific scorekeeping modules: `js/live-scorekeeping-baseball.js`, `js/live-scorekeeping-goal-sports.js`, `js/live-scorekeeping-volleyball.js` → `src/features/scorekeeping/`
- [ ] 12.4 — Create `src/pages/TrackStatsheet.tsx` — port `track-statsheet.html` + `js/track-statsheet-apply.js`
- [ ] 12.5 — Create `src/pages/GameDay.tsx` — port `game-day.html` + all `js/game-day-*.js` modules (entry, periods, lineup publish, live substitutions, wrapup, RSVP breakdown, RSVP controls)
- [ ] 12.6 — Create `src/pages/TrackLive.tsx` — port `track-live.html` + `js/track-live-state.js` + `js/track-finish.js`

---

## PHASE 13 — Search, Help & Global UI
- [ ] 13.1 — Create `src/components/GlobalSearch.tsx` — port `js/global-search.js` + `js/global-search-visibility.js`; render as a sheet/modal accessible from the AppShell
- [ ] 13.2 — Create `src/pages/Help.tsx` and sub-pages — port `help.html`, `help-account.html`, `help-game-operations.html`, `help-team-operations.html`, `help-watch-chat.html`, `help-page-reference.html`

---

## PHASE 14 — Capacitor Final Integration
- [ ] 14.1 — Install `@capacitor/camera`, `@capacitor/push-notifications`, `@capacitor/local-notifications`; update `src/lib/pushNotifications.ts` to use Capacitor plugin on native, web fallback on browser
- [ ] 14.2 — Add iOS safe area inset CSS variables to `src/index.css`; verify AppShell bottom tab bar clears home indicator on iPhone
- [ ] 14.3 — Run `npx cap sync && npx cap open ios` — fix any native build errors; commit working iOS build
- [ ] 14.4 — Run `npx cap sync && npx cap open android` — fix any native build errors; commit working Android build
- [ ] 14.5 — Run full Playwright smoke suite (`playwright.smoke.config.js`) against the Vite dev server; fix any failures

---

## Widget (Standalone — Not in Main App Router)
- [ ] W.1 — Port `widget-scoreboard.html` as a separate Vite entry point (`src/widget/scoreboard.tsx`) that builds to an embeddable bundle; configure in `vite.config.js` as a second rollup input

---

## Do Not Migrate (Skip These)
- All `workflow-*.html` pages — these are tutorial/onboarding docs, not app features; they can be replaced by an in-app help system later
- All `test-*.html` pages — these are manual test harnesses; the Playwright suite replaces them
- `beta/` and `mockups/` directories — prototype only, not production features
- `_migration/` scripts — server-side only, not part of the app

---

## Definition of Done
- [ ] All Phase 0–13 tasks marked `[x]`
- [ ] `npm run build` completes with no errors
- [ ] `npx cap sync` completes with no errors  
- [ ] Playwright smoke suite passes
- [ ] iOS simulator shows login → team dashboard flow without errors
- [ ] Android emulator shows login → team dashboard flow without errors
