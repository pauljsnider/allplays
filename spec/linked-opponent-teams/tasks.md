# Linked Opponent Teams Feature Tasks

## Phase 1: Linking + Roster Preload (MVP)

### Data Model
- [ ] Add `opponentTeamId`, `opponentTeamName`, `opponentTeamPhoto` to game save payloads in `js/db.js`.
- [ ] Ensure clearing a linked team removes linked fields while keeping `opponent` text.

### Schedule UI
- [x] Add opponent team search dropdown to `edit-schedule.html`.
- [x] Implement team search query in `edit-schedule.html` (by name; limit results).
- [x] Show team sport + name in search results and allow selection.
- [x] Persist linked opponent fields when a team is selected.
- [x] Auto-fill the manual opponent text with the selected team name.

### Tracker Pre-Game (Live Tracker)
- [x] Load opponent roster when `opponentTeamId` is present in `live-tracker.html`.
- [x] Add opponent roster selection UI in `live-tracker.html`.
- [x] Allow manual opponent players even when linked.
- [x] Keep quick link flow in live tracker functional and aligned with schedule linking.

### Reports & Display
- [x] Display linked opponent name/logo in `game.html` when available.
- [x] Display opponent player photos in live game and report views where shown.
- [x] Keep backward compatibility for games with only `opponent` text.

### Security & Rules
- [x] Confirm Firestore rules allow public read of opponent players (already public).
- [x] Ensure no write paths target opponent team collections.

### Validation
- [x] Manual test (Playwright): link opponent in schedule, open live tracker, verify roster preload and link section hidden.
- [x] Manual test (Playwright): unlinked game shows link section and no roster.
- [x] Manual test: linked opponent cleared still renders safely (fallback opponent name).

## Status
- Phase 1 complete.
- Phase 2+ deferred.

## Phase 2: Cross-Team Sharing (Future)

### Game References
- [ ] Define `teams/{teamId}/gameReferences/{refId}` schema.
- [ ] Create reference on game completion for linked opponents.

### Import Flow
- [ ] Add schedule UI for “Game Report Available” with import/view options.
- [ ] Implement import logic (copy game data to receiving team).

### Conflict Handling
- [ ] Detect duplicate tracked games between linked teams.
- [ ] Provide “Use Their Version / Keep Mine / Compare” UI.

### Notifications
- [ ] Add notification write on linked game completion.

## Phase 3: Polish (Future)
- [ ] Smart opponent suggestions (previous opponents, same sport, nearby).
- [ ] Head-to-head series rollup.
- [ ] Opponent branding in live viewer.
