# Practice Command Center - Requirements

## Introduction

ALL PLAYS currently excels at game-day stat tracking, live broadcasting, and team management. However, the practice side of coaching remains unaddressed — coaches are forced to juggle spreadsheets, messaging apps, and static PDFs to plan and run training sessions. This creates an "administrative tax" that steals time from actual player development.

The Practice Command Center unifies drill discovery, AI-powered session planning, real-time practice execution, and post-session distribution into a single interface. It follows a "One Screen, One Brain" philosophy: all context (game history, roster, drill library, active timeline) lives on one surface, eliminating the context-switching penalty that leads to planning errors.

The feature launches soccer-first using pre-loaded community drill data from `markcaron/soccer-drills` (CC BY-SA 4.0), with an extensible schema that supports basketball and any custom sport tracked in ALL PLAYS.

## User Stories

- **US-1:** As a coach, I want to browse a pre-loaded library of soccer drills so that I don't have to build my practice plans from scratch.
- **US-2:** As a coach, I want to filter drills by type (Warm-up, Tactical, Technical, Physical, Game), skill, difficulty level, and age group so that I can quickly find relevant exercises.
- **US-3:** As a coach, I want to create my own custom drills and save them to my team's library so that I can capture exercises I've developed or learned.
- **US-4:** As a coach, I want to favorite/bookmark drills so that I can quickly access my go-to exercises.
- **US-5:** As a coach, I want the AI to analyze my team's last three game narratives and stat trends and proactively suggest drills that address specific weaknesses.
- **US-6:** As a coach, I want to plan a full practice session through natural language chat (e.g., "Plan for 8 kids, focus on finishing") and see the AI populate a visual timeline of drills.
- **US-7:** As a coach, I want to drag-and-drop drill cards on a practice timeline and have durations auto-recalculate so that I can adjust plans fluidly.
- **US-8:** As a coach, I want a "Practice Mode" with a big timer, large touch targets, and a "Next Drill" button so that I spend minimal time looking at my phone on the field.
- **US-9:** As a coach, I want to generate a "Home Packet" — a shareable summary of at-home drill variants — so that players can continue development between sessions.
- **US-10:** As a coach, I want to upload a photo of a check-in sheet or paste a messy attendance list and have the AI identify players and adjust drill scaling automatically.
- **US-11:** As a parent, I want to view the upcoming practice plan and any home packets so that I can support my child's development.
- **US-12:** As a team admin, I want to manage the team's custom drill library (create, edit, delete) so that the content stays current and relevant.
- **US-13:** As a global admin, I want to manage the community drill seed data so that all teams benefit from a curated starting library.
- **US-14:** As a coach editing a calendar practice in `edit-schedule.html`, I want a "Plan Practice" action so that I can open the Practice Command Center for that exact practice event.
- **US-15:** As a coach running practice, I want to check attendance (who is here/absent/late) so the timeline and AI suggestions reflect actual participants.

## Requirements (EARS Format)

### 1. Drill Library

#### 1.1 Community Drill Data
1.1.1 The system shall provide a pre-loaded library of soccer drills sourced from `markcaron/soccer-drills` (CC BY-SA 4.0).
1.1.2 Each community drill shall include: title, type, level, age group, skills tags, description, instructions, setup requirements (duration, cones, pinnies, balls, players, area), and full attribution.
1.1.3 Community drills shall be available to all teams without duplication (stored once globally).
1.1.4 The system shall display CC BY-SA 4.0 attribution (author, license, source URL) on every community drill.

#### 1.2 Custom Team Drills
1.2.1 Team owners and admins shall be able to create, edit, and delete custom drills scoped to their team.
1.2.2 Custom drills shall support the same fields as community drills (title, type, level, skills, setup, description, instructions).
1.2.3 Custom drills shall default the sport field to the team's configured sport.
1.2.4 Custom drills shall record `createdBy` (user ID) and timestamps.
1.2.5 The drill detail experience shall provide clear add/edit paths: "Add to Canvas" for session planning and "Edit Drill" for team-owned custom drills.

#### 1.3 Drill Filtering and Search
1.3.1 The system shall support filtering drills by: type (Warm-up, Tactical, Technical, Physical, Game), skill category, difficulty level, and age group.
1.3.2 The system shall support text search across drill titles, descriptions, and skill tags.
1.3.3 Filter changes shall update results without a full page reload.
1.3.4 The system shall provide three tabs: Community, My Drills (team custom), and Favorites.

#### 1.4 Drill Favorites
1.4.1 Team owners and admins shall be able to favorite/unfavorite any drill (community or custom).
1.4.2 Favorites shall be scoped to the team (all admins on a team see the same favorites).
1.4.3 Favorite status shall be indicated on drill cards with a toggle icon.
1.4.4 The Favorites tab shall display all favorited drills for the team.

### 2. Practice Command Center Dashboard

#### 2.1 Four-Quadrant Layout
2.1.1 The dashboard shall use a four-zone layout: Top Bar (metadata), Left Context Rail (AI insights), Center Interaction Surface (AI chat), and Right Practice Canvas (visual timeline).
2.1.2 The Top Bar shall display: Date, Duration, Location, and Attendance Estimates (coaches and players).
2.1.3 The Left Context Rail shall display narratives from the last three games, player highlights, and statistical trends.
2.1.4 The Center Interaction Surface shall provide a natural language chat interface for generating and refining practice plans.
2.1.5 The Right Practice Canvas shall display a dynamic stack of interactive drill cards (Warm-up, Drill, Scrimmage) supporting drag-and-drop reordering.

#### 2.2 Planning Mode (Architect)
2.2.1 In Planning Mode, the system shall prioritize information density with full access to the Context Rail and Drill Library.
2.2.2 The chat interface shall accept natural language commands (e.g., "Plan for 8 kids," "Improve finishing") and populate the Practice Canvas accordingly.
2.2.3 Dragging and dropping a drill card shall auto-recalculate timeline durations and transitions.
2.2.4 The system shall support generating Home Packets — extracting at-home drill variants into a shareable digital handout.

#### 2.3 Practice Mode (Tactician)
2.3.1 When switching to Practice Mode, the Context Rail and Coach Chat shall collapse to prioritize the Practice Canvas.
2.3.2 Practice Mode shall display a large-format "Big Timer" with high-contrast touch targets (minimum 44x44 pixels).
2.3.3 A single-tap "Next Drill" button shall advance to the next card on the timeline.
2.3.4 The system should support voice-to-text note taking during practice execution.
2.3.5 Practice Mode shall include an attendance panel listing team players with per-player status controls (`present`, `late`, `absent`).
2.3.6 Attendance changes during Practice Mode shall update session participant counts and be persisted on the linked practice session.

#### 2.4 Schedule-Linked Practice Planning
2.4.1 From `edit-schedule.html`, each practice-type calendar event shall expose a "Plan Practice" action.
2.4.2 Selecting "Plan Practice" shall open `drills.html` in a schedule-linked context and load the session tied to that event.
2.4.3 The system shall create a new practice session only if no session exists for that practice event.
2.4.4 Practice plans shall be event-specific; editing one practice event plan shall not modify other practices.

### 3. AI Intelligence Layer

#### 3.1 Drill Recommendation
3.1.1 The system shall use Gemini 2.5 Flash to analyze game narratives and stat trends and suggest drills addressing identified weaknesses.
3.1.2 When suggesting drills, the system shall provide no more than 3 options to prevent decision paralysis (Hick's Law).
3.1.3 The system shall prioritize drills tagged with skills matching negative trends from the Context Rail.
3.1.4 If attendance is below 10, the system shall prioritize Small-Sided Games (SSG) over full-field scrimmages.

#### 3.2 Bulk AI Operations
3.2.1 The system shall accept uploaded photos of check-in sheets and use AI to identify players and jersey numbers (handling variations like #7 vs 07).
3.2.2 Upon detecting attendance, the system shall automatically adjust drill scaling on the Practice Canvas.
3.2.3 AI recommendations shall use the current attendance roster (who is present) when generating or revising drill blocks.

#### 3.3 Session Structure
3.3.1 The AI shall ensure a minimum 10-minute warm-up buffer and 5-minute cool-down in all 60-minute sessions.
3.3.2 Every AI chat interaction shall be saved as session "memory" for continuity.

### 4. Access Control

4.1 Team owners and admins shall have full CRUD access to custom drills and practice plans.
4.2 Parents shall have read-only access to practice plans and home packets.
4.3 Global admins shall have CRUD access to community drill seed data.
4.4 Community drills shall be readable by any signed-in user.
4.5 Custom drills shall only be readable by their owning team's admins and owners.
4.6 Attendance status for a practice session shall be writable by team owners/admins and read-only for parent viewers.

### 5. Data Attribution and License Compliance

5.1 All community drills shall store full attribution metadata: source repository, license type, author, and URL.
5.2 Drills with NonCommercial (NC) license tags shall be flagged for team-use only.
5.3 Drills with NoDerivs (ND) licenses shall preserve the original asset intact, with coach notes stored as a separate metadata layer.
5.4 The drill detail view shall display license and attribution information.

### 6. Multi-Sport Extensibility

6.1 The drill data schema shall be sport-agnostic, using a `sport` field and extensible `skills` arrays.
6.2 The skills taxonomy shall be defined per sport (Soccer skills at launch; Basketball, etc. added later).
6.3 The drill library shall automatically filter by the team's configured sport.

### 7. UX Workflow Reference

7.1 The implementation shall follow the interaction flow represented in `mockups/practice-command-center.html` for Planning Mode, Practice Mode, Drill Library, and Drill Detail views.
7.2 The schedule-linked entry flow (`edit-schedule.html` → "Plan Practice" → event-linked `drills.html`) shall preserve the same visual and interaction patterns as the mockup while adding event context.

## Out of Scope (Phase 1)

- Cross-team drill sharing / community marketplace
- 10-week season progression generation
- Live stat tracking during practice scrimmages
- Custom sport template builder
- Video/animation attachments on drills

## Changelog

### 2026-02-16
- Added schedule-linked planning requirements from `edit-schedule.html` to `drills.html` via "Plan Practice" (Req 2.4.1–2.4.4).
- Added Practice Mode attendance requirements for player-level tracking (`present`, `late`, `absent`) and persistence (Req 2.3.5–2.3.6).
- Added AI requirement to use current attendance roster when generating/revising drill plans (Req 3.2.3).
- Added explicit requirement for drill add/edit workflow visibility in drill detail actions (Req 1.2.5).
- Added UX workflow reference to `mockups/practice-command-center.html` and schedule-entry parity expectations (Req 7.1–7.2).
- Removed practice scheduling integration from Phase 1 out-of-scope list; now in scope.
