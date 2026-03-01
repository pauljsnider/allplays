# Game Day Command Center — Requirements

## Introduction

ALL PLAYS excels at game-day stat tracking (`track-basketball.html`, `track.html`), pre-game formation planning (`game-plan.html`), and match reporting (`game.html`). However, the full coaching lifecycle surrounding a game remains fragmented — a coach must jump between planning, lineup management, live game oversight, and post-game retrospective across disconnected pages with no shared context. This creates friction at exactly the moments when a coach needs to be focused on the field, not the screen.

The Game Day Command Center unifies the full game lifecycle into a single surface: **pre-game strategy** (RSVP-aware lineup planning, AI coaching directives, scouting intel), **live game oversight** (substitution dashboard, live stats, coaching notes), and **post-game retrospective hand-off** (wrap-up, AI weakness analysis, practice feed). It follows the same "One Screen, One Brain" philosophy as the Practice Command Center — all game context lives in one place from arrival through final whistle.

The feature is delivered as `game-day.html` (URL: `game-day.html?teamId={teamId}&gameId={gameId}`), accessed from the schedule, match report, or team admin banner.

---

## User Stories

- **US-1:** As a coach, I want to see who is coming to the game (RSVP status) alongside my rotation planning canvas so that I only assign available players to the rotation.
- **US-2:** As a coach, I want AI to generate a pre-game strategic directive based on recent form, RSVP roster, and scouting notes so that I walk onto the field with a focused game plan.
- **US-3:** As a coach, I want to build or refine my rotation plan through natural language chat (e.g., "Balance playing time for 10 players across 4 quarters") so that I don't have to manually fill every grid cell.
- **US-4:** As a coach, I want to see playing time balance bars next to each player so that I can detect inequity before the game starts.
- **US-5:** As a coach, I want to enter Game Day mode with a dark, outdoor-readable display that shows the live score, current period, and upcoming substitution alerts.
- **US-6:** As a coach, I want to see which players are currently on the field, how long they have played, and who is coming in next, so that substitutions happen smoothly without a missed window.
- **US-7:** As a coach, I want to log coaching notes (timeouts, formation changes, quick observations) during the game from the command center without leaving the Game Day view.
- **US-8:** As a coach, I want a Stats View in Game Day mode that lets me log per-player statistics from a tablet or laptop, writing to the same Firestore subcollection as the mobile phone tracker.
- **US-9:** As a coach, I want a lightweight Wrap-Up panel to appear when the game is marked complete so I can confirm the final score, add post-game notes, and trigger AI weakness analysis.
- **US-10:** As a coach opening the next game's command center, I want to see the previous game's weakness analysis automatically surfaced in the Pre-Game intelligence rail so that lessons carry forward without an extra step.
- **US-11:** As a coach, I want to send identified practice weaknesses to `drills.html` with one click so that the next practice directly addresses the game's deficiencies.
- **US-12:** As a coach, I want to enter scouting notes for non-linked opponents so that the AI can incorporate opponent context into its pre-game directives.
- **US-13:** As a coach, I want the AI to suggest a starting lineup based on who is confirmed Going to the game so that attendance drives selection, not just preference.
- **US-14:** As a coach, I want to compare my planned rotation versus actual substitution history at the end of the game so that I can improve future rotation plans.
- **US-15:** As a coach, I want the Game Day command center to be accessible from the schedule view, the match report, and the team admin banner so that I can reach it from any natural workflow touchpoint.
- **US-16:** As a team admin, I want the Game Day mode locked to admins and owners so that parents cannot access live coaching controls or rotation data.
- **US-17:** As a coach, I want to see opponent roster and stats from previous linked encounters so that I can plan matchups against known players.
- **US-18:** As a coach, I want a clear visual substitution alert so that I never miss a planned rotation window during play.

---

## Requirements (EARS Format)

### 1. Pre-Game Mode

#### 1.1 Game Intelligence Rail (Left Panel)

1.1.1 The system shall display a game details card showing: opponent name, date, time, home/away badge, kit color, and planned arrival time, sourced from the `games` document.
1.1.2 The game details card shall provide a link to `edit-schedule.html` for coaches to update game metadata without leaving context.
1.1.3 When the most recently completed game for this team has `practiceFeedItems[]` set, the system shall display a "From Last Game" section at the **top** of the intelligence rail, before other rail content.
1.1.4 The "From Last Game" section shall render each `practiceFeedItem` as a weakness card with a `⚠` or `✓` prefix, weakness description, and evidence text.
1.1.5 Each weakness card in the "From Last Game" section shall include a "Plan Practice Around This" button that navigates to `drills.html` with `weakness` and `drillCategory` passed as query parameters.
1.1.6 The system shall display an RSVP roster panel showing players grouped into three buckets: Going (green chips), Maybe (amber chips), and Not Going / No Response (gray chips).
1.1.7 The RSVP panel shall display a count ("X of Y going") and a "Flag Missing Players" alert action when any rostered players have not submitted an RSVP.
1.1.8 When a linked `opponentTeamId` exists on the game document, the system shall display the opponent's roster entries and historical per-player encounter statistics.
1.1.9 When no linked opponent exists, the system shall display a scouting notes textarea that saves its value to `game.scoutingNotes` on blur.
1.1.10 The system shall display a "Recent Form" section showing the last three completed games as collapsible cards with W/L/D badges, final scores, and a one-sentence AI narrative snippet.
1.1.11 The system shall display 3–4 stat trend rows (e.g., "2nd-half scoring: −15% vs 1st half") computed from recent game `aggregatedStats`.
1.1.12 The system shall display an "AI Coach Focus" card containing a 2–3 sentence strategic pre-game directive generated by Gemini on page load, with a [Refresh] button to regenerate.

#### 1.2 AI Strategy Chat (Center Panel)

1.2.1 The center panel shall provide a natural language chat interface following the same visual and interaction pattern as the Practice Command Center AI chat.
1.2.2 The chat interface shall display a mode toggle pill with two options: **Ask** and **Lineup**.
1.2.3 In Ask mode, the system shall display starter prompt chips including: "How did we do against zone defense?", "Who are our top scorers this season?", and "What matchup concerns should I have?"
1.2.4 In Lineup mode, the system shall display starter prompt chips including: "Suggest a starting lineup based on who's going", "Build a rotation for 10 players across 4 quarters", and "Balance playing time with 2 goalkeepers".
1.2.5 The context payload sent to Gemini shall include: the RSVP going-list, the current rotation plan from the canvas, recent game summaries, scouting notes, and team player statistics.
1.2.6 When Lineup mode returns a rotation proposal from Gemini, the system shall render a structured preview of the proposal in the chat panel with [Accept to Canvas] and [Reject] action buttons.
1.2.7 Accepting a lineup proposal shall populate the corresponding cells in the Rotation Canvas without navigating away.
1.2.8 Every chat message and AI response shall be persisted as session memory for continuity within the coaching session.

#### 1.3 Rotation Canvas (Right Panel)

1.3.1 The rotation canvas shall display period tabs — H1/H2 for two-period games or Q1/Q2/Q3/Q4 for four-period games — derived from `game.gamePlan.numPeriods`.
1.3.2 Each period tab shall display the planned substitution time markers sourced from `game.gamePlan.subTimes`.
1.3.3 The canvas shall render a substitution matrix table with positions as rows and time-slot columns, following the same grid pattern as `game-plan.html`'s sub-matrix.
1.3.4 The canvas shall display a player chip pool below the matrix showing all unassigned players available for drag-and-drop placement into matrix cells.
1.3.5 The canvas shall display per-player playing time balance bars, color-coded: green (within 1 min of target), amber (2–5 min off target), red (>5 min off target).
1.3.6 The canvas shall provide a "From Game Plan" button that loads the existing `game.gamePlan` sub-matrix into the rotation grid without navigating away.
1.3.7 The canvas shall provide a "Balance Playing Time" button that automatically redistributes players across time slots to minimize playing-time inequity.
1.3.8 The canvas shall provide an "AI Optimize Rotation" button that sends the current matrix and RSVP going-list to Gemini and shows the proposal for accept/reject confirmation.

---

### 2. Game Day Mode

#### 2.1 Mode Layout and Theme

2.1.1 Game Day mode shall use a dark color scheme (`bg-gray-900`, `text-white`) designed for outdoor and gym readability.
2.1.2 Game Day mode shall display a persistent top bar containing: live pulse dot + "LIVE" badge (visible only when `game.liveStatus === 'live'`), large score display, current period and clock chip, and a view toggle pill (Coach View / Stats View).
2.1.3 When `game.liveStatus` transitions from `scheduled` to `live`, the system shall display a prompt asking the coach to switch from Pre-Game mode to Game Day mode.
2.1.4 The view toggle pill in the top bar shall switch between Coach View (default) and Stats View without a page reload.

#### 2.2 Sub Alert System

2.2.1 The top bar shall display a "Sub Due" chip in amber when a planned substitution is within 2 minutes of the current clock time.
2.2.2 The "Sub Due" chip shall change to red and pulse when the current clock time has passed a planned substitution window.
2.2.3 Dismissing a sub alert via [Skip This Sub] shall log a `{ type: 'sub_skipped', ... }` entry to `game.coachingNotes[]`.

#### 2.3 Coach View (default Game Day layout)

2.3.1 Coach View left panel shall display an "On Court Now" section listing the five players currently on the field, each with: name, jersey number, jersey color dot, and a running play-time badge.
2.3.2 Coach View shall display a "Next Sub Block" panel highlighted in amber when the next substitution is within 2 minutes, showing: the player coming OUT (name, position, time played), the player coming IN (name, position, rest time), an [Apply Sub Now] button, and a [Skip This Sub] button.
2.3.3 Pressing [Apply Sub Now] shall log the substitution to `game.rotationActual[period][subTime]` with an `appliedAt` timestamp.
2.3.4 Coach View shall display a sub queue timeline strip showing all remaining planned substitutions for the current period in chronological order.
2.3.5 Coach View shall display playing time balance bars for all rostered players, updated in real time from the accumulated `rotationActual` data.
2.3.6 Coach View right panel shall display a live box score reading from `games/{gameId}/aggregatedStats/` via real-time `onSnapshot`, refreshing without user action.
2.3.7 Coach View shall display a "Rotation vs Actual" mini-grid comparing the planned player per position/slot versus the actual player recorded in `rotationActual`; cells where actual deviates from plan shall be highlighted in amber.
2.3.8 Coach View shall provide a quick-action coaching log with tappable action buttons: [Timeout Called], [Change Formation], and a free-text input for quick notes.
2.3.9 All entries logged via the coaching note panel shall be saved to `game.coachingNotes[]` with the fields: `{ text, type, period, clockTime, createdAt }`.

#### 2.4 Stats View (toggled Game Day layout)

2.4.1 Stats View shall display a player roster table with one row per player showing: name, jersey number, on-court indicator, and per-stat tap buttons (+1pt, +2pt, +3pt, +REB, +AST, +TO, +FOUL for basketball; configurable by sport via the game's `statTrackerConfigId`).
2.4.2 Players currently on the court shall be visually highlighted; bench players shall be visually dimmed.
2.4.3 Tapping a stat button shall write a stat increment to `games/{gameId}/aggregatedStats/{playerId}` and emit a corresponding event to `games/{gameId}/liveEvents/`.
2.4.4 Stats View shall display a rolling game log showing the last 10 events with: event timestamp, player name and number, and event description.
2.4.5 Stats View shall display a period selector and an [Undo Last] button that reverses the most recent stat event.
2.4.6 Stats View shall write to the same Firestore subcollections (`aggregatedStats`, `liveEvents`) as `track-basketball.html`, allowing both tools to be used simultaneously or interchangeably during a game.

---

### 3. Post-Game: Wrap-Up Panel

3.1 When `game.liveStatus` transitions to `completed`, the system shall display a Wrap-Up panel (inline card or modal overlay) without requiring a full page navigation.
3.2 The Wrap-Up panel shall display editable final score fields pre-populated from `game.homeScore` and `game.awayScore`.
3.3 The Wrap-Up panel shall provide a coach post-game notes input (text area) and an optional voice note trigger, saving the result to `game.postGameNotes` on submission.
3.4 The Wrap-Up panel shall provide an "Analyze Game" button that sends final `aggregatedStats` and `coachingNotes[]` to Gemini; the AI response shall be saved as `game.practiceFeedItems[]`, each entry containing: `{ weakness, evidence, drillCategory, urgency, addedAt }`.
3.5 The Wrap-Up panel shall provide a "Generate Summary" button that creates a match summary narrative via Gemini and saves it to `game.summary`; this button shall be disabled if `game.summary` is already populated.
3.6 The Wrap-Up panel shall provide a "Done — See Match Report" button that navigates to `game.html?teamId={teamId}&gameId={gameId}`.
3.7 The Wrap-Up panel shall require no more than four user interactions before the coach can dismiss it, keeping the post-game flow fast.

---

### 4. AI Integration

#### 4.1 Pre-Game Directive

4.1.1 On Pre-Game mode load, the system shall automatically invoke Gemini with a prompt containing: recent game summaries, stat trends, scouting notes, and the RSVP going-list, generating a 2–3 sentence coaching focus directive.
4.1.2 The directive shall appear in the "AI Coach Focus" card in the intelligence rail within 5 seconds of page load; a loading skeleton shall be shown during generation.

#### 4.2 "From Last Game" Intelligence Feed

4.2.1 On Pre-Game mode load, the system shall query the most recently completed game for this team and read its `practiceFeedItems[]` array.
4.2.2 `practiceFeedItems[]` generated via the Wrap-Up "Analyze Game" action shall also surface in `drills.html`'s left-rail Coach Focus section when the practice is planned for the same team.

#### 4.3 Lineup Chat (Lineup Mode)

4.3.1 In Lineup mode, Gemini shall respond with structured rotation proposals following a defined JSON schema mapping period → time-slot → player assignments by position.
4.3.2 The system shall parse the AI proposal and render it as a visual preview in the chat panel before writing to the canvas.
4.3.3 Accepting a proposal shall write all proposed position/player assignments to the Rotation Canvas in one action; rejecting shall preserve the current canvas state unchanged.

#### 4.4 Sub Suggestion (Coach View)

4.4.1 Coach View shall provide an on-demand "Suggest Sub" button that calls Gemini with: the current on-court players and their play-times, bench players and their rest-times, and the planned rotation schedule.
4.4.2 The AI response shall suggest a substitution pair with a brief rationale, rendered as a card in the Next Sub Block panel area.

#### 4.5 Wrap-Up Analysis

4.5.1 The "Analyze Game" Gemini call shall include: final `aggregatedStats` for all players, all `coachingNotes[]` entries, and the most recent 3-game context.
4.5.2 The response shall produce 2–5 `practiceFeedItems` entries ranked by `urgency` (high / medium / low).
4.5.3 All AI calls shall use `getGenerativeModel()` from `js/firebase.js` targeting Gemini 2.5 Flash, consistent with the Practice Command Center and basketball tracker.

---

### 5. Data Integration

#### 5.1 Game Document Fields

5.1.1 The system shall read and write the following new fields on `games/{gameId}`:
- `scoutingNotes` (string) — coach-entered opponent scouting notes
- `coachingNotes` (array) — time-stamped in-game coach log entries
- `postGameNotes` (string) — post-game coach notes from Wrap-Up
- `rotationActual` (map) — actual substitutions applied during the game
- `practiceFeedItems` (array) — AI-generated weakness items for practice planning

5.1.2 The `coachingNotes` entry schema shall be: `{ text: string, type: string, period: string, clockTime: string, createdAt: Timestamp }`.
5.1.3 The `practiceFeedItems` entry schema shall be: `{ weakness: string, evidence: string, drillCategory: string, urgency: 'high'|'medium'|'low', addedAt: Timestamp }`.
5.1.4 The `rotationActual` schema shall be: `{ [period: string]: { [subTime: string]: Array<{ position: string, out: string, in: string, appliedAt: Timestamp }> } }`.

#### 5.2 Live Data Subscriptions

5.2.1 The system shall use `subscribeGame(teamId, gameId, callback)` from `js/db.js` to receive real-time score and `liveStatus` updates.
5.2.2 The system shall use a new `subscribeAggregatedStats(teamId, gameId, callback)` wrapper in `js/db.js` that subscribes to the `aggregatedStats` subcollection via `onSnapshot`.
5.2.3 The system shall use a new `subscribeLiveEvents(teamId, gameId, callback)` wrapper in `js/db.js` that subscribes to the last 20 `liveEvents` ordered by timestamp descending.
5.2.4 The system shall use `getRsvps(teamId, gameId)` from `js/db.js` to fetch the RSVP roster for the Pre-Game intelligence rail on mount.

#### 5.3 Practice CC Handoff

5.3.1 `practiceFeedItems[]` written during Wrap-Up analysis shall be readable by `drills.html` to surface in its Coach Focus left-rail section for the same team.
5.3.2 The "Plan Practice Around This" navigation action shall encode `weakness` and `drillCategory` as URL query parameters on the `drills.html` link.

---

### 6. Access Control

6.1 `game-day.html` shall be accessible only to: team owners, team admins (listed in `teams/{teamId}.adminEmails[]`), and global admins (`users/{uid}.isAdmin === true`).
6.2 A parent-role user navigating to `game-day.html` shall be redirected to the team view page with an explanatory message.
6.3 All write operations (coaching notes, rotation actual, post-game notes, AI analysis trigger) shall be gated by the same Firestore security rules that apply to team admin operations.
6.4 The Stats View stat-write path shall enforce the same Firestore rules as `track-basketball.html` stat writes.

---

### 7. Navigation and Entry Points

7.1 `edit-schedule.html` shall expose a "Command Center" action button on each game-type calendar event row, linking to `game-day.html?teamId={teamId}&gameId={gameId}`.
7.2 `game.html` shall expose a "Command Center" button in its admin controls section for team owners and admins.
7.3 The team admin banner (`team-admin-banner.js`) shall include a "Game Day" nav icon card that links to the next upcoming game's command center URL.
7.4 Pressing "Done — See Match Report" in the Wrap-Up panel shall navigate to `game.html?teamId={teamId}&gameId={gameId}`.
7.5 Pressing "Plan Practice Around This" from any weakness card shall navigate to `drills.html?teamId={teamId}&weakness={encoded}&drillCategory={encoded}`.
7.6 The "From Game Plan" button in the Rotation Canvas shall load `game.gamePlan` into the canvas without navigating away from the command center.

---

## Out of Scope (Phase 1)

- Native mobile app version of the Game Day Command Center
- Video clip tagging during game play
- Opponent data ingestion from external sources or APIs
- Automated clock synchronization with a physical scoreboard
- Multi-coach simultaneous collaborative editing of the rotation canvas
- Parent-visible live stats overlay within `game-day.html`

---

## Changelog

### 2026-02-18

- Initial requirements spec created for Game Day Command Center, covering Pre-Game, Game Day, Wrap-Up, AI integration, data model, access control, and navigation requirements (US-1 through US-18; Req 1.1 through 7.6).
