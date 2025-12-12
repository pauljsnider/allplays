# Going From Beta Mock → Live Basketball Tracker

This note documents what was done to turn the in‑memory beta basketball mobile tracker into a production, Firebase‑backed tracker in the main site. Use this as a checklist/template for future “beta → live” ports.

## 1) Keep the beta version intact

- Left these files unchanged:
  - `beta/track-basketball-mobile-mock.html`
  - `beta/js/track-basketball-mobile-mock.js`
- Beta continues to be a zero‑backend sandbox for UX iteration.

## 2) Create main‑site copies

- Copied beta mock into root as new live pages:
  - `beta/track-basketball-mobile-mock.html` → `track-basketball.html`
  - `beta/js/track-basketball-mobile-mock.js` → `js/track-basketball.js`
- Updated paths and branding in `track-basketball.html`:
  - Favicon path from `../img/...` to `img/...`
  - Removed “Mobile Lab / in‑memory mock” language
  - Pointed script tag to `js/track-basketball.js`

## 3) Wire the live JS to Firebase like `track.html`

### 3.1 Auth + bootstrap

- Mirrored `track.html` startup:
  - `checkAuth(...)`, redirect to `login.html` if no user.
  - Read `teamId`/`gameId` from URL hash via `getUrlParams()`.
  - Load `team`, `game`, `players` in parallel.
  - Redirect practices back to schedule (practices are not trackable).

### 3.2 Determine sport + columns from config

- Used the same config model as `track.html`:
  - If game has `statTrackerConfigId`, fetch configs and pick that one.
  - Else fall back to default basketball columns:
    - `['PTS', 'REB', 'AST', 'STL', 'TO']`
- Rendered pills/buttons dynamically from `currentConfig.columns`.
- Treated `PTS/POINTS/GOALS` as “points columns” to update score (same rule as `track.html`).

### 3.3 Initialize in‑memory state (no realtime DB writes)

- Kept the beta “all in memory until finish” philosophy.
- Built `roster` from real players:
  - `{ id, num, name, pos, photoUrl }`
- Initialized:
  - `state.stats[playerId][statKey]` for each configured column
  - `state.opp` from `game.opponentStats` if present, else 3 empty opponent slots
  - `state.home/state.away` from game doc, with recalculation from player stats when needed

### 3.4 “Start” behavior / clearing old data

- Followed `track.html`’s safety pattern:
  - On first Start, if no local activity and Firestore already has events/stats,
    prompt the user to clear prior tracked data.
  - If confirmed, delete:
    - `events` subcollection docs
    - `aggregatedStats` subcollection docs
    - reset game doc scores/opponentStats

### 3.5 Finish → batch write to Firestore

- Added a “Save & Complete” button in the finish panel.
- On click, created a `writeBatch` and wrote:
  1. **Events**  
     - Each log entry to `teams/{teamId}/games/{gameId}/events`
     - Same fields as `track.html`:
       - `text, gameTime, period, timestamp, type, playerId, statKey, value, isOpponent, createdBy`
  2. **Aggregated stats**  
     - Each player to `.../aggregatedStats/{playerId}`
     - `{ playerName, playerNumber, stats: { <statKey>: number } }`
  3. **Game document update**  
     - `{ homeScore, awayScore, summary, status:'completed', opponentStats }`
     - Opponent stats shaped the same way as `track.html`.
- Committed batch once.

### 3.6 Email + AI summary

- Implemented both using the same patterns as `track.html`:
  - **AI summary**: lazy‑load `firebase-ai.js`, call Gemini, populate finish notes.
  - **Email recap**: build plaintext body identical in structure to `track.html`’s `generateEmailBody`.
  - Optional mailto send after save.

## 4) Route to beta vs standard from schedule (basketball only)

- Left `track.html` unchanged.
- Updated only `edit-schedule.html`:
  - Replaced the “Track” link for DB games with a button.
  - On click:
    - If selected game config `baseType === 'Basketball'` (or team sport fallback),
      show modal chooser:
        - **Standard** → `track.html`
        - **Beta** → `track-basketball.html`
    - Otherwise go straight to `track.html`.

## 5) UX polish added during port

- More compact period controls + separate purple “Subs” affordance.
- Start/Pause uses green/red to match game flow.
- Player photos/initials integrated in lineup, live cards, bench, and subs modal without increasing layout height much.

## 6) Template for future ports

When moving another beta tracker live:

1. Copy beta HTML/JS to root + `js/`.
2. Update asset paths and branding in HTML.
3. Replace hardcoded data with:
   - `checkAuth`, `getUrlParams`
   - `getTeam/getGame/getPlayers/getConfigs`
4. Keep in‑memory tracking; avoid realtime Firestore writes unless required.
5. Reuse `track.html` data schema on finish:
   - events + aggregatedStats + game update in a single batch.
6. If needed, add a chooser modal in schedule for opt‑in rollout.
7. Do small UX polish passes once parity is reached.

