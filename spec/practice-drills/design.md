# Practice Command Center - Design Document

## Overview

The Practice Command Center replaces fragmented coaching workflows with a unified interface built on a "One Screen, One Brain" philosophy. All context — game history, roster status, drill library, and active timeline — lives on a single surface.

**Design priorities:**
- Cognitive load reduction: no context-switching between planning tools
- Real-time fluidity: instant plan modifications when conditions change
- Contextual intelligence: Gemini 2.5 Flash as the "connective tissue" between game data and drill selection
- Administrative efficiency: collapse the distance between "The Plan" and "The Practice"

## Architecture

### System Layers

```
┌─────────────────────────────────────────────────────┐
│                  drills.html                         │
│  (Practice Command Center - Single Page Dashboard)  │
│  (opened directly OR from edit-schedule "Plan")     │
├────────────┬──────────────┬─────────────────────────┤
│ Context    │ AI Chat      │ Practice Canvas          │
│ Rail       │ Interface    │ (Drill Timeline)         │
│ (read-only)│ (Gemini 2.5) │ (drag-and-drop cards)   │
├────────────┴──────────────┴─────────────────────────┤
│                  js/db.js                            │
│  getDrills() | createDrill() | getDrillFavorites()   │
│  getPracticeSessionByEvent() | upsertPracticeSession │
├─────────────────────────────────────────────────────┤
│                 Firestore                            │
│  /drillLibrary/{drillId}                             │
│  /teams/{teamId}/drillFavorites/{drillId}            │
│  /teams/{teamId}/practiceSessions/{sessionId}        │
├─────────────────────────────────────────────────────┤
│              Gemini 2.5 Flash                        │
│  Game narrative analysis | Drill recommendations     │
│  Attendance parsing | Home packet generation         │
└─────────────────────────────────────────────────────┘
```

### Navigation Entry Points

- **Team Admin Banner:** New "Drills" icon card → `drills.html#teamId={teamId}`
- **Dashboard:** New "Drills" button in team card quick actions
- **Parent Dashboard:** Read-only link to view practice plans and home packets
- **Edit Schedule:** Practice events expose "Plan Practice" → `drills.html#teamId={teamId}&eventId={eventId}&source=edit-schedule`

### Operational Modes

The dashboard supports two modes via a seamless state toggle (not separate pages):

| Aspect | Planning Mode (Architect) | Practice Mode (Tactician) |
|--------|--------------------------|---------------------------|
| **Focus** | Content creation, logistics | Minimal distraction, field presence |
| **UI Priority** | Information density | Glanceability |
| **Context Rail** | Visible (game insights, trends) | Collapsed |
| **AI Chat** | Visible (primary interaction) | Collapsed |
| **Practice Canvas** | Standard drill cards | Large-format Big Timer + Next Drill |
| **Attendance** | Estimated counts and AI intake | Live player check-in (`present`, `late`, `absent`) |
| **Workflow** | Chat-driven, drag-and-drop, Home Packets | Big Timer, single-tap advance, voice notes, attendance tracking |

Fitts's Law governs Practice Mode: large, high-contrast touch targets for Big Timer and Next Drill reduce phone-staring time, increasing player feedback frequency.

---

## Data Model

### Architecture Decision: Single Global Collection

**Chosen approach:** Single top-level `/drillLibrary/{drillId}` collection with a `source` discriminator.

**Why:**
- Seed data stored once (not duplicated per team) — efficient at scale
- Single query path for the UI
- Security rules differentiate by `source` field
- Favorites are lightweight references, not data copies
- Future: community sharing via `visibility` field

**Rejected alternatives:**
- All drills under `/teams/{teamId}/drills/` — duplicates seed data per team
- Separate `/drills/` + `/teams/{teamId}/customDrills/` — complex UI merging two collections

### Drill Document: `/drillLibrary/{drillId}`

```javascript
{
    // Identity
    title: "Passing & Communication Square",
    slug: "passing-communication-square",        // URL-friendly, dedup key for imports

    // Classification
    sport: "Soccer",                             // "Soccer", "Basketball", etc.
    type: "Warm-up",                             // "Warm-up", "Tactical", "Technical", "Physical", "Game"
    level: "All",                                // "All", "Initial", "Basic", "Intermediate", "Advanced", "Professional"
    ageGroup: "All",                             // "All", "U6", "U7", "U6-U8", etc.
    skills: ["passing", "communication"],         // array of skill tags
    objectiveTags: ["Technical"],                 // high-level objective categories

    // Content
    description: "Simple passing warm-up...",     // short summary
    instructions: "## Setup\n\nPlace cones...",  // full markdown body
    homeVariant: null,                            // text for at-home version (Home Packets)

    // Setup / Equipment
    setup: {
        duration: 10,                             // minutes
        cones: 8,
        pinnies: "optional",                      // "yes", "no", "optional"
        balls: { min: 4, max: 10 },
        players: { min: 8, max: 20 },
        area: { min: "10 x 10", max: "20 x 20" } // yards
    },

    // Ownership / Source
    source: "community",                          // "community" | "custom"
    teamId: null,                                 // null for community, teamId for custom
    createdBy: null,                              // null for seed, userId for custom
    author: "Mark Caron",

    // Attribution & License
    attribution: {
        source: "markcaron/soccer-drills",
        license: "CC BY-SA 4.0",
        url: "https://github.com/markcaron/soccer-drills"
    },
    sourceLicenseType: "CC BY-SA 4.0",           // for quick filtering/flagging

    // Metadata
    createdAt: Timestamp,
    updatedAt: Timestamp
}
```

### Drill Favorites: `/teams/{teamId}/drillFavorites/{drillId}`

Document ID = drill ID (O(1) existence check, natural dedup).

```javascript
{
    addedBy: "userId",
    addedAt: Timestamp
}
```

### Practice Session: `/teams/{teamId}/practiceSessions/{sessionId}`

```javascript
{
    // Event Linkage (schedule-specific planning)
    eventId: "event_2026_03_12_6pm_practice",      // ID from edit-schedule event
    eventType: "practice",                         // guardrail: only practice events
    sourcePage: "edit-schedule",                   // "drills" | "edit-schedule"

    // Metadata (Top Bar)
    date: Timestamp,
    duration: 60,                                 // minutes
    location: "Main Field",
    attendanceCoaches: 2,
    attendancePlayers: 14,

    // Timeline (Practice Canvas)
    blocks: [
        {
            order: 0,
            drillId: "abc123",                    // reference to /drillLibrary/{id}
            drillTitle: "Passing Square",          // denormalized for fast render
            type: "Warm-up",
            duration: 10,                          // minutes allocated
            notes: "Focus on weak foot"
        },
        {
            order: 1,
            drillId: "def456",
            drillTitle: "1v1 Finishing",
            type: "Drill",
            duration: 15,
            notes: null
        }
    ],

    // AI Context
    aiChatHistory: [
        { role: "user", content: "Plan for 8 kids, focus on finishing", timestamp: Timestamp },
        { role: "assistant", content: "Here's a 60-min plan...", timestamp: Timestamp }
    ],
    gameContextIds: ["game1", "game2", "game3"],  // last 3 games analyzed
    aiContext: {
        presentPlayerIds: ["p1", "p4", "p7"],     // attendance-aware AI prompts
        attendanceSummary: { present: 12, late: 1, absent: 3 }
    },

    // Attendance Tracking (Practice Mode)
    attendance: {
        rosterSize: 16,
        checkedInCount: 13,
        updatedAt: Timestamp,
        players: [
            { playerId: "p1", displayName: "A. Smith", status: "present", checkedInAt: Timestamp, note: null },
            { playerId: "p2", displayName: "B. Jones", status: "late", checkedInAt: Timestamp, note: "Arrived 10 min late" },
            { playerId: "p3", displayName: "C. Lee", status: "absent", checkedInAt: null, note: "School event" }
        ]
    },

    // Home Packet
    homePacketGenerated: false,
    homePacketContent: null,                       // markdown content for sharing

    // Ownership
    createdBy: "userId",
    status: "draft",                               // "draft" | "active" | "completed"
    createdAt: Timestamp,
    updatedAt: Timestamp
}
```

### Skills Taxonomy (JavaScript Constants)

Stored as static constants in code (not Firestore) since they change rarely:

```javascript
const DRILL_SKILLS = {
    Soccer: {
        "Awareness": ["attacking", "defending", "identifying space", "providing support", "change of direction"],
        "Ball Control": ["dribbling", "receiving", "turning"],
        "Communication": ["communication"],
        "Conditioning": ["conditioning"],
        "Finishing": ["finishing"],
        "Goalkeeping": ["basics", "conditioning", "distribution", "diving", "reflexes", "situational"],
        "Passing": ["passing", "short passing", "long passing", "wall passing"],
        "Shooting": ["power", "finishing", "volleys", "long shots", "driven shots", "ball striking"],
        "Dribbling": ["ball mastery", "close control", "speed dribbling", "1v1 moves"],
        "First Touch": ["ground control", "aerial control", "turning with ball", "one-touch control"],
        "Fitness": ["speed", "agility", "endurance"],
        "Other": ["ice breaker", "strength building"]
    }
    // Future: Basketball: { "Ball Handling": [...], "Rebounding": [...], ... }
};

const DRILL_TYPES = ["Warm-up", "Tactical", "Technical", "Physical", "Game"];
const DRILL_LEVELS = ["All", "Initial", "Basic", "Intermediate", "Advanced", "Professional"];
```

---

## Components

### 1. Team Admin Banner Update (`js/team-admin-banner.js`)

Add "Drills" nav card as 8th item in the full-access nav grid:
- New SVG icon (whistle or clipboard-list) in the `icon()` function
- New `drills` entry in `hrefs`: `drills.html#teamId=${teamId}`
- Update grid: `grid-cols-2 sm:grid-cols-4 lg:grid-cols-8`

### 2. Drills Page (`drills.html`)

**URL:** `drills.html#teamId={teamId}`
**Schedule-linked URL:** `drills.html#teamId={teamId}&eventId={eventId}&source=edit-schedule`

#### Four-Quadrant Dashboard Layout

```
┌──────────────────────────────────────────────────────────┐
│  TOP BAR: Date | Duration | Location | Attendance        │
│  [Planning Mode ◉] [Practice Mode ○]                     │
├──────────┬──────────────────┬────────────────────────────┤
│ CONTEXT  │  AI COACH CHAT   │  PRACTICE CANVAS           │
│ RAIL     │                  │                             │
│          │  "Plan for 8     │  ┌──────────────────────┐  │
│ Last 3   │   kids, focus    │  │ ● Warm-up     10 min │  │
│ Games:   │   on finishing"  │  │   Passing Square      │  │
│          │                  │  ├──────────────────────┤  │
│ ● Game 1 │  AI: "Here's a   │  │ ● Drill       15 min │  │
│   W 3-1  │   plan focused   │  │   1v1 Finishing       │  │
│ ● Game 2 │   on shooting    │  ├──────────────────────┤  │
│   L 0-2  │   drills..."     │  │ ● Drill       15 min │  │
│ ● Game 3 │                  │  │   Rondo 4v2           │  │
│   W 2-1  │  [Send]          │  ├──────────────────────┤  │
│          │                  │  │ ● Scrimmage   15 min │  │
│ Trends:  │                  │  │   5v5 Small-Sided     │  │
│ FT err   │                  │  ├──────────────────────┤  │
│ +20% 2H  │                  │  │ ● Cool-down    5 min │  │
│          │                  │  └──────────────────────┘  │
│          │                  │                             │
│          │                  │  [+ Add Drill] [Home Pkt]  │
├──────────┴──────────────────┴────────────────────────────┤
│  DRILL LIBRARY (expandable panel)                         │
│  [Community] [My Drills] [Favorites]                      │
│  Type: [All ▼] Level: [All ▼] Skill: [All ▼] [Search..] │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐            │
│  │ Card 1 │ │ Card 2 │ │ Card 3 │ │ Card 4 │            │
│  │ Warm-up│ │ Tech   │ │ Tact   │ │ Phys   │            │
│  │ ♥      │ │ ♥      │ │ ♥      │ │ ♥      │            │
│  └────────┘ └────────┘ └────────┘ └────────┘            │
└──────────────────────────────────────────────────────────┘
```

#### Practice Mode Layout

```
┌──────────────────────────────────────────────────────────┐
│  PRACTICE MODE                          [Exit to Plan]   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│              ┌─────────────────────┐                     │
│              │                     │                     │
│              │      12:34          │    ← Big Timer      │
│              │                     │      (high contrast)│
│              └─────────────────────┘                     │
│                                                          │
│         Current: Passing Square (Warm-up)                │
│         "Focus on weak foot"                             │
│                                                          │
│     ┌───────────────────────────────────┐                │
│     │         NEXT DRILL →              │  ← Large tap   │
│     │     1v1 Finishing (15 min)        │     target      │
│     └───────────────────────────────────┘                │
│                                                          │
│  Progress: ████████░░░░░░░░░░░░  2 of 5 blocks          │
│                                                          │
│  [🎤 Voice Note]                                         │
│                                                          │
│  ATTENDANCE (live)                                       │
│  [✓] A. Smith   [Late] B. Jones   [Absent] C. Lee       │
│  Checked in: 13/16                                       │
└──────────────────────────────────────────────────────────┘
```

#### UX Workflow Reference

The target interaction flow is represented in `mockups/practice-command-center.html`, including:
- Planning Mode composition (Context + AI Chat + Canvas)
- Practice Mode timer-first layout
- Drill Library tabs and filtering
- Drill Detail actions (favorite, edit/delete custom drill, add to canvas)

Schedule-linked launch and live attendance are extensions that must preserve this visual and interaction language.

### 3. Drill Card Component

Each card in the library grid shows:
- Title (bold)
- Type badge (color-coded: Warm-up=green, Tactical=blue, Technical=purple, Physical=orange, Game=red)
- Level and age group
- Skills as small tags
- Favorite heart toggle (top-right)
- Click → opens drill detail modal

Responsive grid: 1 col mobile, 2 col sm, 3 col md, 4 col lg.

### 4. Drill Detail Modal

Full overlay showing all drill fields:
- Title, type badge, level, age group
- Skills tags
- Setup requirements (duration, cones, balls, players, area, pinnies)
- Description
- Instructions (rendered markdown)
- Home Variant (if available)
- Attribution block for community drills
- Action buttons: Favorite toggle, Edit (custom only), Delete (custom only), Add to Canvas

### 5. AI Coach Chat Interface

- Text input with send button
- Scrollable message history (user + AI responses)
- Messages saved to `practiceSessions.aiChatHistory`
- Powered by Gemini 2.5 Flash via existing Firebase GenAI integration (`js/firebase.js`)
- In event-linked sessions, prompts include schedule metadata (date, location, duration) and live attendance summary

**AI Instructional Constraints:**
1. If `attendance < 10`, prioritize SSG over full-field scrimmages
2. Prioritize drills matching negative trends from Context Rail
3. Provide no more than 3 drill options per suggestion (Hick's Law)
4. Ensure 10-min warm-up buffer and 5-min cool-down in 60-min sessions
5. Use checked-in player count and present-player roster when proposing drill scale and role assignments

### 7. Schedule Integration (edit-schedule)

- `edit-schedule.html` shows "Plan Practice" on practice events
- CTA opens `drills.html` with `teamId` + `eventId`
- `drills.html` resolves session by `eventId`; creates draft session if missing
- Session remains scoped to that event (no cross-event overwrite)
- Returning to `edit-schedule.html` surfaces linked plan summary (duration, block count, status)

### 8. Attendance Tracker (Practice Mode)

- Attendance drawer/panel visible in Practice Mode
- Player rows support quick status toggles: `present`, `late`, `absent`
- Attendance changes persist to `practiceSessions.attendance.*`
- Header and AI context update immediately from live attendance values
- Optional AI check-in intake: parse uploaded check-in photo/text and prefill statuses

### 6. Home Packet Generator

- "Home Packet" button on Practice Canvas
- AI extracts drills with `homeVariant` content
- Generates a shareable markdown summary
- Stored on `practiceSessions.homePacketContent`
- Viewable by parents on parent dashboard

---

## db.js Functions

Following existing patterns (`getConfigs()`, `createConfig()`, etc.):

### Drill Library CRUD

```
getDrills(options)           — query community drills with filters (sport, type, level, skill, limit, pagination)
getTeamDrills(teamId)        — query custom drills for a team
getDrill(drillId)            — get single drill by ID
createDrill(teamId, data)    — create custom drill (sets source:"custom", teamId, createdBy)
updateDrill(drillId, data)   — update custom drill
deleteDrill(drillId)         — delete custom drill
```

### Drill Favorites

```
getDrillFavorites(teamId)              — get all favorite IDs for a team
addDrillFavorite(teamId, drillId)      — add to favorites (setDoc with drillId as doc ID)
removeDrillFavorite(teamId, drillId)   — remove from favorites
isDrillFavorited(teamId, drillId)      — check if favorited (getDoc existence check)
```

### Practice Sessions

```
getPracticeSessions(teamId)                     — list sessions for a team
getPracticeSession(teamId, sessionId)           — get single session
getPracticeSessionByEvent(teamId, eventId)      — get session linked to a schedule practice event
createPracticeSession(teamId, data)             — create new session
upsertPracticeSessionForEvent(teamId, eventId, data) — create/update event-linked session
updatePracticeSession(teamId, sessionId, data)  — update session (blocks, notes, status)
updatePracticeAttendance(teamId, sessionId, attendance) — update attendance statuses/counts
deletePracticeSession(teamId, sessionId)        — delete session
```

---

## Firestore Security Rules

### `/drillLibrary/{drillId}` (top-level)

```
read:   signed-in AND (source == "community" OR teamId == null OR isTeamOwnerOrAdmin(teamId))
create: (source == "community" AND isGlobalAdmin()) OR
        (source == "custom" AND teamId != null AND isTeamOwnerOrAdmin(teamId))
update: (source == "community" AND isGlobalAdmin()) OR
        (source == "custom" AND isTeamOwnerOrAdmin(teamId))
delete: same as update
```

### `/teams/{teamId}/drillFavorites/{favoriteId}` (inside teams match)

```
read:    isTeamOwnerOrAdmin(teamId)
create:  isTeamOwnerOrAdmin(teamId)
delete:  isTeamOwnerOrAdmin(teamId)
update:  false (immutable — add/remove only)
```

### `/teams/{teamId}/practiceSessions/{sessionId}` (inside teams match)

```
read:    isTeamOwnerOrAdmin(teamId) OR isParentOnTeam(teamId)
create:  isTeamOwnerOrAdmin(teamId)
update:  isTeamOwnerOrAdmin(teamId)
delete:  isTeamOwnerOrAdmin(teamId)
```

---

## Firestore Indexes

Add to `firestore.indexes.json`:

```json
[
    {
        "collectionGroup": "drillLibrary",
        "queryScope": "COLLECTION",
        "fields": [
            { "fieldPath": "sport", "order": "ASCENDING" },
            { "fieldPath": "type", "order": "ASCENDING" },
            { "fieldPath": "title", "order": "ASCENDING" }
        ]
    },
    {
        "collectionGroup": "drillLibrary",
        "queryScope": "COLLECTION",
        "fields": [
            { "fieldPath": "sport", "order": "ASCENDING" },
            { "fieldPath": "skills", "arrayConfig": "CONTAINS" }
        ]
    },
    {
        "collectionGroup": "drillLibrary",
        "queryScope": "COLLECTION",
        "fields": [
            { "fieldPath": "source", "order": "ASCENDING" },
            { "fieldPath": "teamId", "order": "ASCENDING" },
            { "fieldPath": "title", "order": "ASCENDING" }
        ]
    },
    {
        "collectionGroup": "practiceSessions",
        "queryScope": "COLLECTION",
        "fields": [
            { "fieldPath": "eventId", "order": "ASCENDING" },
            { "fieldPath": "status", "order": "ASCENDING" },
            { "fieldPath": "updatedAt", "order": "DESCENDING" }
        ]
    }
]
```

---

## Seed Data Import

### Source: `markcaron/soccer-drills` (CC BY-SA 4.0)

Create `_migration/import-drill-library.js` following the existing migration script pattern.

**Process:**
1. Clone `markcaron/soccer-drills` locally
2. Parse each `.md` file: extract YAML front matter + markdown body
3. Generate slug from title for idempotent imports
4. Check for existing slugs in Firestore before inserting
5. Map YAML fields to Firestore document schema
6. Set `source: "community"`, `teamId: null`, `attribution` with full CC BY-SA 4.0 details

**Field Mapping:**

| YAML Field | Firestore Field |
|------------|-----------------|
| `title` | `title` |
| `title` (slugified) | `slug` |
| (hardcoded) | `sport: "Soccer"` |
| `type` | `type` |
| `level` | `level` |
| `ages` | `ageGroup` |
| `skills` | `skills` |
| `desc` | `description` |
| markdown body | `instructions` |
| `setup.duration` | `setup.duration` |
| `setup.cones` | `setup.cones` |
| `setup.pinnies` | `setup.pinnies` |
| `setup.balls` | `setup.balls` |
| `setup.players` | `setup.players` |
| `setup.area` | `setup.area` |
| `author` | `author` |

**Dependencies:** `firebase-admin`, `js-yaml` (add to `_migration/` package.json)

---

## License Compliance

| License Type | Handling |
|-------------|----------|
| **CC BY-SA 4.0** (markcaron) | Full reuse allowed. Store attribution. Display on detail view. Any adaptations must remain CC BY-SA 4.0 compatible. |
| **NonCommercial (NC)** | Flag for team-use only. Exclude from any future commercialized tiers. |
| **NoDerivs (ND)** | Preserve original asset intact. Coach notes stored as separate metadata, not modifying the drill content. |
| **No license** (most repos) | Do not import. Use for inspiration only. |

---

## Multi-Sport Extensibility

The schema is sport-agnostic by design:
- `sport` field on every drill filters by team's configured sport
- `skills` array swaps per sport (Soccer: "Passing", Basketball: "Ball Handling")
- `DRILL_SKILLS` constant is keyed by sport name
- Adding a new sport = adding a new key to `DRILL_SKILLS` + seeding drills
- Same dashboard, same Canvas, same AI chat — only drill content changes

---

## Future State Roadmap

1. **Basketball Integration:** Connect Live Stat Tracker to Practice Canvas for practice scrimmage rotation tracking
2. **Global Plan Generation:** AI creates 10-week progressions mapping focus areas across sessions
3. **Custom Sport Templates:** Organizations define their own stat columns and drill tags
4. **Cross-Team Sharing:** `visibility: "public"` field on custom drills + "Copy to My Drills" flow
5. **Advanced Scheduling Sync:** recurring-series propagation, conflict detection, and plan templates across calendar weeks

---

## Changelog

### 2026-02-16
- Added schedule-linked architecture and navigation entry from `edit-schedule.html` with event-context URL parameters (`teamId`, `eventId`, `source`).
- Extended `practiceSessions` model with `eventId` linkage and live attendance structures for player-level status tracking.
- Added Practice Mode attendance UX expectations and persistence behavior.
- Added AI integration details to include schedule metadata and attendance-aware prompts/scaling.
- Added db function surface for event-linked session resolution/upsert and attendance updates.
- Added `practiceSessions` Firestore index guidance for event-linked lookups.
- Added explicit UX workflow reference to `mockups/practice-command-center.html` and parity expectations.
- Replaced roadmap "Practice Scheduling" item with "Advanced Scheduling Sync" to reflect newly in-scope core scheduling linkage.
- Implemented schedule-row linked plan summary in `edit-schedule.html` (status, block count, duration) for DB and calendar practice entries.
- Implemented attendance-aware planning behavior in `drills.html` chat flow, including persisted `aiContext.presentPlayerIds` and `aiContext.attendanceSummary`.
