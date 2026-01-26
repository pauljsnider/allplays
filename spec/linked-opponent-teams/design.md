# Linked Opponent Teams Feature Design

## Overview

Phase 1 introduces opponent team linking during scheduling and pre-loading opponent rosters during tracking. The linked opponent is stored on the game document to enable richer tracking and reporting.

Phase 2 (out of scope for this spec) will add game references, import workflows, and conflict handling.

## UX Entry Points

### Primary: Schedule Edit (`edit-schedule.html`)
- Opponent input supports search + select from ALL PLAYS teams.
- A “Link to opponent team” toggle (or implicit selection) persists linked fields.
- Manual opponent text remains the fallback and is always editable.
- Selecting a team auto-fills the manual opponent text with the team name.

### Secondary: Tracker (`track-basketball.html`)
- Quick link from the tracker remains available and persists the same linked fields.
- If a game is linked, show opponent roster in pre-game setup.
- Allow selecting opponent players to track (checkbox list).
- Provide “Add Opponent Player” for manual entries.

## Data Model

### Game Document (existing: `teams/{teamId}/games/{gameId}`)
```json
{
  "opponent": "KC Thunder",
  "opponentTeamId": "abc123",
  "opponentTeamName": "KC Thunder",
  "opponentTeamPhoto": "https://..."
}
```

### Opponent Stats & Photos (existing structure, augmented)
Opponent stat entries can optionally include:
- `playerId`
- `photoUrl`

These fields are used for display but do not require cross-team writes.

## Firestore Access

- Read-only access to `teams/{opponentTeamId}/players` for roster preload (already public).
- No writes to opponent team collections.

## Search Algorithm (Phase 1)
- Name-based search of teams (case-insensitive starts-with or contains).
- Display sport + name for disambiguation.
 - Results include all teams (no visibility filter in Phase 1).

## Components & Files

- `edit-schedule.html` + `js/db.js`: opponent search, selection, and game save updates.
- `track-basketball.html` + `js/track-basketball.js`: pre-game opponent roster selection.
- `game.html`, `live-game.html`, and `js/live-game.js`: display linked opponent name/logo and opponent player photos where shown.

## Edge Cases

- Linked opponent deleted: fall back to stored `opponentTeamName` + `opponent`.
- Opponent roster empty: still allow manual opponent players.
- Sport mismatch: allow linking but surface sport in selection list.

## Phase 2 Hooks (not implemented here)
- `gameReferences` collection for cross-team sharing.
- Notification pipeline for “game tracked by opponent”.
- Conflict UI for dual-tracked games.

## Status
- Phase 1 complete.
- Phase 2+ deferred.
