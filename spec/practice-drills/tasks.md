# Practice Command Center - Tasks

## Phase 1: Data Foundation (Drill Library + Seed Data)

- [x] **1.1** Add drill library CRUD functions to `js/db.js`
  - `getDrills(options)` — query community drills with filters (sport, type, level, skill, limit, pagination cursor)
  - `getTeamDrills(teamId)` — query custom drills for a team
  - `getDrill(drillId)` — get single drill by ID
  - `createDrill(teamId, data)` — create custom drill (sets source, teamId, createdBy, timestamps)
  - `updateDrill(drillId, data)` — update custom drill
  - `deleteDrill(drillId)` — delete custom drill
  - Follow existing `getConfigs()` / `createConfig()` patterns
  - *Ref: Req 1.1, 1.2; Design: db.js Functions*
  - **Test:** Call `getDrills({ sport: "Soccer" })` from console, verify returns array

- [x] **1.2** Add drill favorites functions to `js/db.js`
  - `getDrillFavorites(teamId)` — get all favorite doc IDs
  - `addDrillFavorite(teamId, drillId)` — setDoc with drillId as doc ID
  - `removeDrillFavorite(teamId, drillId)` — deleteDoc
  - `isDrillFavorited(teamId, drillId)` — getDoc existence check
  - *Ref: Req 1.4; Design: Drill Favorites*
  - **Test:** Add/remove a favorite, verify doc exists/removed in Firestore console

- [x] **1.3** Add drill skills taxonomy constants
  - Create `DRILL_SKILLS`, `DRILL_TYPES`, `DRILL_LEVELS` constants
  - Place in `js/db.js` or a new `js/drill-constants.js` (follow team preference)
  - Soccer skills from markcaron taxonomy + BravoBall extensions
  - Structure keyed by sport name for future extensibility
  - *Ref: Req 6.1, 6.2; Design: Skills Taxonomy*
  - **Test:** Import constants and verify Soccer skills categories render correctly

- [x] **1.4** Update `firestore.rules` with drill library rules
  - Add `/drillLibrary/{drillId}` match block at top level
  - Community drills: read for all signed-in users, write for global admin only
  - Custom drills: read/write for team owner/admin based on `teamId` field
  - Add `/teams/{teamId}/drillFavorites/{favoriteId}` inside existing teams block
  - Favorites: read/create/delete for team owner/admin, no update (immutable)
  - *Ref: Req 4.1–4.5; Design: Firestore Security Rules*
  - **Test:** Deploy rules, verify coach can read community drills but not write them

- [x] **1.5** Update `firestore.indexes.json` with drill indexes
  - Composite index: `source` + `teamId` + `title` (for custom drill queries)
  - Composite index: `sport` + `type` + `title` (for filtered library queries)
  - Composite index: `sport` + `skills` array-contains (for skill filtering)
  - *Ref: Design: Firestore Indexes*
  - **Test:** Deploy indexes, verify queries don't throw index-not-ready errors

- [x] **1.6** Create seed data import migration script
  - Create `_migration/import-drill-library.js`
  - Add `js-yaml` to migration dependencies
  - Parse YAML front matter + markdown body from markcaron/soccer-drills `.md` files
  - Map fields per design doc field mapping table
  - Generate slugs for idempotent re-runs (skip existing slugs)
  - Set `source: "community"`, `teamId: null`, full `attribution` object
  - Implemented in `_migration/import-drill-library.js` with `drillLibrary` target + fallback service account key path
  - *Ref: Req 1.1, 5.1; Design: Seed Data Import*
  - **Test:** Run script, verify documents appear in Firebase console with correct schema

- [x] **1.7** Run seed data import and verify
  - Clone `markcaron/soccer-drills` repository locally
  - Run import script against Firestore
  - Verify document count matches source file count
  - Spot-check 3-5 drills for correct field mapping
  - Verify attribution fields populated correctly
  - Executed on 2026-02-16: imported 12 community drills, then reran idempotency check with 12 skips / 0 imports / 0 errors
  - *Ref: Req 1.1.1–1.1.4*
  - **Test:** Open Firebase console, browse `/drillLibrary/` collection

## Phase 2: Drill Library Page (Browse + Filter + Detail)

- [x] **2.1** Add "Drills" nav card to `js/team-admin-banner.js`
  - Add whistle/clipboard SVG icon to `icon()` function
  - Add `drills` entry to `hrefs` object: `drills.html#teamId=${teamId}`
  - Add Drills `actionCard` to full-access nav grid
  - Update grid class for 8 items: `grid-cols-2 sm:grid-cols-4 lg:grid-cols-8`
  - *Ref: Design: Team Admin Banner Update*
  - **Test:** Navigate to any team page, verify Drills icon appears in banner

- [x] **2.2** Add "Drills" button to `dashboard.html` team cards
  - Add Drills button in quick actions grid for full-access teams
  - Link to `drills.html#teamId=${team.id}`
  - Match existing button styling
  - *Ref: Design: Navigation Entry Points*
  - **Test:** Open dashboard, verify Drills button appears on team cards

- [x] **2.3** Create `drills.html` base page structure
  - HTML boilerplate matching existing pages (Tailwind CDN, head, body pattern)
  - Import modules: auth, db, utils, team-admin-banner with cache-busting params
  - Parse `teamId` from URL hash
  - Parse optional schedule-linked params: `eventId`, `source`
  - Auth check, team load, access level check
  - Render team admin banner with `active: 'drills'`
  - If `eventId` is present, load/create the event-linked practice session context
  - Placeholder containers for each dashboard quadrant
  - *Ref: Req 2.4; Design: Four-Quadrant Dashboard Layout, Schedule Integration*
  - **Test:** Open `drills.html#teamId={id}` and `drills.html#teamId={id}&eventId={eventId}&source=edit-schedule`, verify both modes load correctly

- [x] **2.4** Implement drill library panel with tabs
  - Three tabs: Community, My Drills, Favorites
  - Community tab: calls `getDrills()` with sport filter from team
  - My Drills tab: calls `getTeamDrills(teamId)`
  - Favorites tab: calls `getDrillFavorites(teamId)`, then batch-fetches full docs
  - Active tab state management
  - *Ref: Req 1.3.4; Design: drills.html*
  - **Test:** Switch tabs, verify each loads correct drill set

- [x] **2.5** Implement filter bar UI
  - Dropdowns: Type (from `DRILL_TYPES`), Level (from `DRILL_LEVELS`), Skill (from `DRILL_SKILLS[sport]`)
  - Text search input (client-side filter on title/description/skills)
  - Sport pre-set from team's sport field
  - Filter changes trigger re-query without page reload
  - *Ref: Req 1.3.1–1.3.3*
  - **Test:** Select "Warm-up" type filter, verify only warm-up drills display

- [x] **2.6** Implement drill card rendering
  - Card component: title, type badge (color-coded), level, age group, skills tags
  - Heart icon for favorite toggle (top-right corner)
  - Click card opens detail modal
  - Responsive grid: 1 col mobile, 2 col sm, 3 col md, 4 col lg
  - Empty state messages per tab
  - *Ref: Req 1.3; Design: Drill Card Component*
  - **Test:** Verify cards render correctly, responsive layout works on mobile

- [x] **2.7** Implement drill detail modal
  - Modal overlay with full drill information
  - Sections: title, type/level/age badges, skills tags, setup table, description, instructions
  - Render markdown instructions (headers, bullets, bold — extend existing `formatMessageText` pattern or add lightweight `marked.min.js`)
  - Attribution block for community drills (author, license, source link)
  - Action buttons: Favorite toggle, Add to Canvas, Edit (custom only), Delete (custom only)
  - Close on backdrop click or X button
  - *Ref: Req 1.1.4, 1.2.5, 5.4; Design: Drill Detail Modal*
  - **Test:** Click a drill card, verify modal shows all fields with proper formatting

- [x] **2.9** Validate UX parity with `mockups/practice-command-center.html`
  - Match core layout and interactions for Planning, Practice, Library, and Detail flows
  - Preserve current design language while adding event-linked context
  - Document any intentional deviations (and why)
  - Completed with side-by-side parity checklist in `spec/practice-drills/ux-parity-checklist.md`
  - *Ref: Req 7.1–7.2; Design: UX Workflow Reference*
  - **Test:** Side-by-side review of mockup vs implementation for all primary flows

- [x] **2.8** Implement pagination / load more
  - Load drills in batches of 24
  - "Load more" button at bottom
  - Track pagination cursor using Firestore `startAfter`
  - *Ref: Design: db.js getDrills pagination*
  - **Test:** Seed 30+ drills, verify initial load shows 24 and "Load more" fetches the rest

## Phase 3: Coach Drill Creation and Editing

- [x] **3.1** Implement "Create Drill" button and form
  - "+ New Drill" button visible only for team owner/admin
  - Opens create form (modal or inline panel)
  - Fields: title, type (dropdown), level (dropdown), age group, skills (comma-separated or multi-select), duration, cones, pinnies, balls, players, area, description (textarea), instructions (textarea)
  - Sport defaults to team's sport
  - Validation: title required, at least one skill
  - On submit: call `createDrill(teamId, data)`, refresh drill list
  - *Ref: Req 1.2.1–1.2.4; Design: Create/Edit Drill*
  - **Test:** Create a custom drill, verify it appears in My Drills tab

- [x] **3.2** Implement edit drill functionality
  - Edit button on detail modal for custom drills owned by this team
  - Pre-populate form with existing values
  - On save: call `updateDrill(drillId, data)`, refresh list
  - Community drills are read-only (no edit button shown)
  - *Ref: Req 1.2.1*
  - **Test:** Edit a custom drill title, verify update persists

- [x] **3.3** Implement delete drill functionality
  - Delete button on detail modal for custom drills only
  - Confirmation dialog before deletion
  - Call `deleteDrill(drillId)`, refresh list
  - Handle gracefully if drill was favorited (stale favorite is OK — skip on render)
  - *Ref: Req 1.2.1*
  - **Test:** Delete a custom drill, verify it disappears from list

## Phase 4: Favorites and Bookmarks

- [x] **4.1** Implement favorite toggle on drill cards
  - Heart/star icon on each card
  - Click toggles favorite (optimistic UI update)
  - Calls `addDrillFavorite()` or `removeDrillFavorite()`
  - *Ref: Req 1.4.1–1.4.3*
  - **Test:** Toggle favorite on a drill, verify icon state changes and persists on reload

- [x] **4.2** Pre-load favorite state for efficient rendering
  - On page load, fetch all favorite IDs with `getDrillFavorites(teamId)`
  - Store in a `Set` for O(1) lookup when rendering cards
  - Update Set on toggle without full re-fetch
  - *Ref: Design: Drill Favorites*
  - **Test:** Load page with 5 favorites, verify all 5 render with filled heart icon

- [x] **4.3** Implement Favorites tab
  - Fetch favorite IDs, then batch-fetch full drill documents
  - Handle deleted drills gracefully (skip or remove stale favorite)
  - Show empty state when no favorites
  - *Ref: Req 1.4.4*
  - **Test:** Favorite 3 drills, switch to Favorites tab, verify all 3 appear

## Phase 5: Practice Canvas (AI-Powered Planning)

- [x] **5.1** Add practice session CRUD functions to `js/db.js`
  - `getPracticeSessions(teamId)` — list sessions ordered by date
  - `getPracticeSession(teamId, sessionId)` — get single session
  - `getPracticeSessionByEvent(teamId, eventId)` — get session linked to schedule event
  - `createPracticeSession(teamId, data)` — create new session
  - `upsertPracticeSessionForEvent(teamId, eventId, data)` — create/update event-linked session
  - `updatePracticeSession(teamId, sessionId, data)` — update blocks, notes, status
  - `updatePracticeAttendance(teamId, sessionId, attendance)` — update attendance roster/statuses/counts
  - `deletePracticeSession(teamId, sessionId)` — delete session
  - Add Firestore rules for `/teams/{teamId}/practiceSessions/{sessionId}`
  - *Ref: Req 2.1, 2.3.5–2.3.6, 2.4; Design: Practice Sessions*
  - **Test:** Create/read/update/delete a practice session from console

- [x] **5.7** Implement schedule-linked launch from `edit-schedule.html`
  - Add "Plan Practice" action for practice-type events only
  - Route to `drills.html#teamId={teamId}&eventId={eventId}&source=edit-schedule`
  - On return to schedule view, show linked plan summary (status, duration, block count)
  - Ensure each plan is scoped to one event; no cross-event overwrite
  - *Ref: Req 2.4.1–2.4.4; Design: Schedule Integration*
  - **Test:** Open two different practice events, verify each has a distinct linked plan

- [x] **5.2** Implement Practice Canvas (Right Quadrant)
  - Dynamic stack of drill cards representing the session timeline
  - Each card shows: drill title, type badge, allocated duration, coach notes
  - "+" button to add a drill from library to canvas
  - Duration totals auto-calculate
  - *Ref: Req 2.1.5, 2.2.3*
  - **Test:** Add 3 drills to canvas, verify total duration matches sum

- [x] **5.3** Implement drag-and-drop reordering on Practice Canvas
  - Drag handles on each card
  - Drop repositions card and updates `blocks[].order`
  - Auto-save to Firestore on reorder
  - *Ref: Req 2.2.3*
  - **Test:** Drag drill from position 1 to position 3, verify order persists

- [x] **5.4** Implement Context Rail (Left Quadrant)
  - Fetch last 3 games for the team via existing `getGames()` / game summary data
  - Display game narratives, highlights, and stat trends
  - Read-only feed
  - *Ref: Req 2.1.3*
  - **Test:** Verify last 3 games render with scores and any available narrative

- [x] **5.5** Implement AI Coach Chat (Center Quadrant)
  - Text input + send button
  - Integrate with Gemini 2.5 Flash via existing Firebase GenAI (`js/firebase.js`)
  - System prompt includes: drill library context, team roster, last 3 game narratives, attendance
  - AI responses populate/modify Practice Canvas blocks
  - Chat history saved to `practiceSessions.aiChatHistory`
  - Implement AI constraints: max 3 suggestions, warm-up buffer, SSG for small groups
  - Completed with Gemini 2.5 Flash integration and deterministic fallback when AI is unavailable
  - *Ref: Req 2.2.2, 3.1.1–3.1.4, 3.3*
  - **Test:** Type "Plan for 8 kids, focus on finishing" — verify canvas populates with relevant drills

- [x] **5.6** Implement Home Packet generation
  - "Home Packet" button on Practice Canvas
  - AI extracts drills with `homeVariant` content from current canvas
  - Generates shareable markdown summary
  - Saves to `practiceSessions.homePacketContent`
  - *Ref: Req 2.2.4, US-9*
  - **Test:** Generate home packet, verify content includes at-home drill variants

## Phase 6: Practice Mode (Execution)

- [x] **6.1** Implement Planning ↔ Practice mode toggle
  - Toggle button in top bar
  - Practice Mode: collapse Context Rail and AI Chat
  - Expand Practice Canvas to full width
  - *Ref: Req 2.3.1; Design: Operational Modes*
  - **Test:** Toggle to Practice Mode, verify Context Rail and Chat collapse

- [x] **6.2** Implement Big Timer
  - Large-format countdown timer (high contrast, min 44x44px touch targets)
  - Counts down current drill's allocated duration
  - Auto-advances to next drill or plays alert sound
  - *Ref: Req 2.3.2*
  - **Test:** Start timer on 10-min drill, verify countdown and completion alert

- [x] **6.3** Implement "Next Drill" button
  - Single-tap advances to next card on timeline
  - Large touch target, high contrast
  - Shows upcoming drill name and duration
  - *Ref: Req 2.3.3*
  - **Test:** Tap Next Drill, verify timer resets and current drill advances

- [x] **6.4** Implement voice-to-text notes (stretch)
  - Microphone button using Web Speech API
  - Transcribed notes saved to current block's `notes` field
  - *Ref: Req 2.3.4*
  - **Test:** Tap mic, speak a note, verify text appears in drill card notes

- [x] **6.5** Implement Practice Mode attendance tracker
  - Add attendance panel/drawer with full roster for the session/team
  - Per-player status toggles: `present`, `late`, `absent`
  - Persist changes to `practiceSessions.attendance.*`
  - Update top-bar counts and practice metadata from live attendance
  - *Ref: Req 2.3.5–2.3.6, 4.6; Design: Attendance Tracker*
  - **Test:** Toggle multiple player statuses and verify values persist after reload

- [x] **6.6** Wire attendance into AI planning updates
  - Include live attendance summary + present player IDs in AI prompt context
  - Recompute suggested drill scaling when attendance changes
  - Preserve existing constraints (max 3 suggestions, warm-up/cool-down, SSG for small groups)
  - *Ref: Req 3.1.4, 3.2.3; Design: AI Coach Chat Interface*
  - **Test:** Mark players absent and request plan update; verify AI adjusts drill sizes/format

## Phase 7: Polish and Deployment

- [x] **7.1** Add loading states and skeleton loaders
  - Spinner while drills load
  - Skeleton cards during filter changes
  - Loading indicator on favorite toggle
  - Implemented skeleton cards for library loading and disabled/loading states for chat send + save session actions
  - *Ref: Existing patterns from dashboard.html*
  - **Test:** Throttle network, verify loading states appear

- [x] **7.2** Add error handling and toasts
  - Failed drill load: error with retry button
  - Failed favorite toggle: revert UI, show toast
  - Failed create/edit/delete: show error toast
  - Failed AI chat: show error with retry
  - Expanded error toasts/retry handling for context load, library load, load more, drill detail open, attendance save, and AI fallback
  - *Ref: Existing patterns from team-chat.html*
  - **Test:** Simulate network failure, verify error states render

- [x] **7.3** Add empty states for all views
  - No community drills matching filters: "No drills match your filters."
  - No custom drills: "Your team hasn't created any drills yet."
  - No favorites: "No favorited drills yet."
  - No practice sessions: "No practice plans yet. Start chatting with the AI Coach."
  - *Ref: Design: UI Components*
  - **Test:** Clear all filters on empty library, verify empty state message

- [x] **7.4** Deploy Firestore rules and indexes
  - `firebase deploy --only firestore:rules`
  - `firebase deploy --only firestore:indexes`
  - Verify in Firebase console
  - Deployed on 2026-02-16 to project `game-flow-c6311` using:
  - `firebase deploy --only firestore:rules,firestore:indexes --project game-flow-c6311`
  - *Ref: Design: Security Rules, Indexes*
  - **Test:** Verify rules and indexes active in Firebase console

- [x] **7.5** Parent read-only access
  - Parents see Drills link in banner (read-only)
  - Practice plans and home packets visible
  - No create/edit/delete/favorite buttons shown
  - *Ref: Req 4.2*
  - **Test:** Log in as parent, verify read-only view

## Phase 8: Future Extensibility (Post-MVP)

- [ ] **8.1** Basketball drill integration
  - Add Basketball skills taxonomy to `DRILL_SKILLS`
  - Source/create basketball seed drills
  - Auto-filter drills by team's sport
  - *Ref: Req 6.1–6.3; Design: Multi-Sport Extensibility*

- [ ] **8.2** Advanced scheduling sync
  - Recurring-series propagation for linked practice plans
  - Conflict detection across team calendar resources
  - Optional templated plan cloning across selected practice events

- [ ] **8.3** AI season progression generation
  - 10-week progression plans mapping focus areas across sessions
  - AI maps "Weeks 1-3: Technical Foundation" → appropriate drill sequences

- [ ] **8.4** Cross-team drill sharing
  - Add `visibility: "public" | "team"` field to custom drills
  - Browse other teams' public drills
  - "Copy to My Drills" functionality

- [ ] **8.5** Bulk AI attendance parsing
  - Upload photo of check-in sheet
  - AI identifies players by name/number (handles #7 vs 07 variations)
  - Auto-adjust drill scaling on canvas based on detected attendance
  - *Ref: Req 3.2.1–3.2.2*

- [ ] **8.6** Custom sport templates
  - Organizations define their own stat columns and drill tags
  - Opens the Command Center to any sport in the ALL PLAYS ecosystem

## Manual Validation Checklist (Current Scope)

Run this checklist before merge/release for schedule-linked practice planning and attendance-aware planning.

1. Schedule entry → linked plan creation
  - Open `edit-schedule.html` for a team with practice events.
  - Click `Plan Practice` on a single DB practice event.
  - Verify `drills.html` opens with `teamId`, `eventId`, `source=edit-schedule` in URL hash.
  - Add 2+ drills and click `Save Draft`.
  - Return to schedule and verify plan summary appears on that event row (status, blocks, duration).

2. Event isolation
  - Open a different practice event and create/save a different plan.
  - Return to first event and verify original plan remains unchanged.
  - Confirm each event has distinct `eventId` linkage in Firestore `practiceSessions`.

3. Recurring + calendar practice flows
  - For a recurring practice occurrence, click `Plan Practice` and save changes.
  - For an untracked calendar practice event, click `Plan Practice` and save changes.
  - Verify both show linked plan summaries when revisiting schedule.

4. Attendance tracking persistence
  - In `drills.html` Practice Mode, toggle several players across `present`, `late`, `absent`.
  - Refresh page and verify statuses and checked-in count persist.
  - Verify `practiceSessions.attendance.players` and `attendance.checkedInCount` update in Firestore.

5. Attendance-aware AI planning behavior
  - Set checked-in count below 10 and send a planning prompt in AI chat.
  - Verify generated plan includes small-sided game emphasis and recalculated block durations.
  - Set attendance above/equal 10 and repeat prompt; verify full-group progression output.
  - Verify `practiceSessions.aiContext.presentPlayerIds` and `attendanceSummary` are updated.

6. Parent read-only safety check
  - Log in as a parent user for the team.
  - Verify attendance buttons are disabled and no write actions are available.
  - Verify practice plan data remains viewable.
