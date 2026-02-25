# Feature Requests Implementation Plan

## Context

The user has requested enhancements across four areas: game schedule fields, practice planner improvements, drill enhancements, and a new global calendar page. All work will be done on a new feature branch. The app is static HTML + vanilla JS + Firebase with no build step.

---

## Phase 1: Game Schedule Field Extensions

**Files:** `edit-schedule.html`, `team.html`, `parent-dashboard.html`, `js/db.js`

**New fields on game documents** (`/teams/{teamId}/games/{gameId}`):
- `isHome` (Boolean|null) — Home/Away toggle
- `kitColor` (String|null) — Free text, e.g. "White home kit"
- `arrivalTime` (Timestamp|null) — Separate from game time
- `notes` (String|null) — Free text
- `cancelledAt`, `cancelledBy` — Set when `status` is changed to `'cancelled'`

**Steps:**
1. Add form fields (Home/Away toggle, Kit Color input, Arrival Time picker, Notes textarea) to the game form in `edit-schedule.html` (~line 92-136)
2. Update `startEditGame()` (~line 1201) to populate new fields when editing
3. Update form submit handler (~line 1247) to include new fields in `gameData`
4. Add "Cancel Game" button to game cards in `edit-schedule.html`. On click: set `status: 'cancelled'` and auto-post cancellation message to team chat (using existing `postChatMessage()` pattern)
5. Update `renderDbGame()` in `team.html` (~line 981) to display: HOME/AWAY badge, kit color, arrival time, notes, and cancelled state (strikethrough + red badge)
6. Update `parent-dashboard.html` event rendering to show new fields
7. Add `cancelGame(teamId, gameId, userId)` helper to `db.js`

---

## Phase 2: Game Assignments with Carry-Forward

**Files:** `edit-schedule.html`, `team.html`, `parent-dashboard.html`, `js/db.js`

**New field on game documents:**
- `assignments` — Array of `{ role: String, value: String }` (e.g. `{ role: "Snack", value: "John's family" }`)

**Steps:**
1. Add dynamic "Assignments" section to game form — rows with role + value text inputs, "Add Row" button
2. Add `getLatestGameAssignments(teamId)` to `db.js` — queries most recent game with assignments to carry forward role names and optionally values
3. On new game creation, pre-populate assignment roles from the latest game
4. Display assignments on game cards in `team.html` and `parent-dashboard.html`

**Depends on:** Phase 1

---

## Phase 3: Availability / RSVP

**Files:** `parent-dashboard.html`, `team.html`, `edit-schedule.html`, `js/db.js`, `firestore.rules`

**New subcollection:** `/teams/{teamId}/games/{gameId}/rsvps/{userId}`
```
{ userId, displayName, playerIds[], response: "going"|"maybe"|"not_going", respondedAt, note }
```

**Denormalized summary on game doc:** `rsvpSummary: { going, maybe, notGoing, total }`

**Steps:**
1. Add Firestore security rules for RSVP subcollection (user writes own RSVP, coach reads all)
2. Add `submitRsvp()`, `getRsvps()`, `getMyRsvp()` to `db.js`
3. Add RSVP buttons (Going / Maybe / Not Going) to event cards in `parent-dashboard.html`
4. Show RSVP summary counts on game cards in `team.html`
5. Add RSVP detail view for coaches (modal in `edit-schedule.html`)

**Depends on:** Phase 1

---

## Phase 4: Drill Enhancements (YouTube + Diagrams)

**Files:** `drills.html`, `js/db.js`

**New fields on drill documents:**
- `youtubeUrl` (String|null)
- `diagramUrls` (String[] — up to 5 image URLs)

Images upload to `game-flow-img` Firebase Storage at `drill-diagrams/{drillId}/{timestamp}_{filename}`

**Steps:**
1. Add YouTube URL text input to drill create/edit form in `drills.html`
2. Add YouTube embed rendering in drill detail modal (parse video ID, render iframe)
3. Add multi-file upload UI with preview thumbnails for diagram images (using existing `firebase-images.js` pattern)
4. Add `uploadDrillDiagram(drillId, file)` to `db.js`
5. Add image gallery in drill detail modal (horizontal scroll, click to enlarge)
6. Update `createDrill()` and `updateDrill()` in `db.js` to include new fields

**No dependencies — can run in parallel with Phases 1-3**

---

## Phase 5: Practice Planner Enhancements

**Files:** `drills.html`, `js/db.js`

### 5A: Edit Drill on Canvas
- Add "Edit" button to each canvas block (~line 1722)
- Open inline expansion with: custom instructions textarea, duration override, notes
- Save to `state.canvasBlocks[index].customInstructions` / `customSetup`

### 5B: Practice Structure Blocks
New block type in `practiceSession.blocks[]`:
```
{
    blockType: "structure",
    structureType: "warmup"|"stations"|"scrimmage"|"cooldown"|"custom",
    title: String, duration: Number,
    groupCount: Number|null, rotationTime: Number|null,
    grouping: String|null,  // e.g. "3 rotating stations, 4-5 players per coach"
    notes: String|null,
    children: [ /* nested drill blocks */ ]
}
```

**Steps:**
1. Add "Add Structure Block" button above canvas with picker (Warm-up, Stations, Scrimmage, Cooldown, Custom)
2. Update `renderCanvas()` to render structure blocks as container cards with nested drill areas
3. Extend drag-and-drop to support dropping drills into structure block children
4. For "Stations" type: show group count, rotation time, and multiple concurrent drill slots

### 5C: AI Structure Proposals + Templates
- Extend AI chat to propose a structure when starting a new session
- Add "Save as Template" / "Load Template" UI
- Add `savePracticeTemplate()`, `getPracticeTemplates()`, `deletePracticeTemplate()` to `db.js`
- Templates stored at `/teams/{teamId}/practiceTemplates/{templateId}`

**Depends on:** Phase 4

---

## Phase 6: Global Calendar Page

**Files:** NEW `calendar.html`, `dashboard.html`, `js/db.js`

Design modeled after `/Users/paulsnider/paulsnidernet/family/events.html`:

**Three views:** Detailed list, Compact list, Calendar grid (month view)

**Filters:** Time range (Week/Month/Quarter/All), Event type (Games/Practices/All), Team filter

**Steps:**
1. Create `calendar.html` with Tailwind-styled layout matching app chrome
2. Load data: iterate user's teams, fetch games + ICS calendars, merge and deduplicate
3. Build filter bar with toggle buttons (time, type, team)
4. Build detailed list view (full event cards with all fields from Phases 1-3)
5. Build compact list view (one-line per event)
6. Build calendar grid: CSS Grid 7 columns / 42 cells, month nav (prev/next), color-coded event dots by team
7. Build day-click popup modal with full event details
8. Build .ics export
9. Add "Calendar" nav link to `dashboard.html` and `parent-dashboard.html`

**Depends on:** Phases 1, 3

---

## Phase Dependency Graph

```
Phase 1 (Game Fields) ───┬──> Phase 2 (Assignments)
                         ├──> Phase 3 (RSVP) ──────┐
                         │                          │
Phase 4 (Drills) ────────┴──> Phase 5 (Practice) ──┤
                                                    v
                                              Phase 6 (Calendar)
```

Phases 1 and 4 can begin in parallel.

---

## Verification

- Serve locally: `python3 -m http.server 8000`
- Test game creation with new fields at `edit-schedule.html`
- Test cancel flow and verify team chat message appears
- Test RSVP from parent-dashboard, verify summary on team.html
- Test drill creation with YouTube URL + diagram uploads
- Test practice planner: add structure blocks, edit drill on canvas, save/load templates
- Test calendar.html: all three views, filters, day popup, .ics export
- Verify Firestore rules with `firebase deploy --only firestore:rules`
