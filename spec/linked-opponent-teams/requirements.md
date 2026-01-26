# Linked Opponent Teams Feature Requirements

## Introduction

When two ALL PLAYS teams play each other, coaches can link the opponent team so the tracker can pre-load the opponent roster, and games can be shared across teams. This improves tracking accuracy and reduces duplicate data entry.

This spec focuses on Phase 1 (linking + roster preload) with clear extension points for cross-team sharing in Phase 2.

## User Stories

### US-1: Coach links opponent during scheduling
As a coach scheduling a game, I want to select an opponent team in ALL PLAYS so that the opponent roster can be loaded for tracking.

### US-2: Stat tracker loads opponent roster
As a stat tracker, I want the opponent roster pre-loaded so I can track opponent stats faster and more accurately.

### US-3: Tracker adds unlisted opponents
As a stat tracker, I want to add opponent players manually if they are missing so that I can still track the game.

### US-4: Coach sees linked opponent in game report
As a coach reviewing a game, I want to see the linked opponent information so that the report is clear and trustworthy.

## Requirements (EARS Format)

### 1. Linking Opponents in Schedule
1.1 When a user creates or edits a game in `edit-schedule.html`, the system shall allow linking the opponent to an existing team in ALL PLAYS.

1.2 When a linked opponent is selected, the system shall persist `opponentTeamId`, `opponentTeamName`, and `opponentTeamPhoto` on the game document.

1.3 When a linked opponent is cleared, the system shall remove linked opponent fields from the game document but retain the manual `opponent` text field.

1.4 The system shall not require linking; manual opponent entry shall continue to work.

### 2. Linking Opponents in Tracker (Quick Link)
2.1 The tracker shall continue to allow linking an opponent team from the tracking flow without breaking existing tracking behavior.

2.2 When a team is linked via the tracker, the system shall persist the same linked fields as schedule linking.

### 3. Opponent Search & Suggestions (Phase 1 - basic search)
3.1 When the user types in the opponent field, the system shall show matching teams by name.

3.2 The system shall show the selected team’s sport and name in the search results.

3.3 The system shall allow the user to keep the manual opponent text even if no team is selected.

3.4 When a team is selected, the system shall auto-fill the manual opponent text with the team’s name.

### 4. Tracker Pre-Game Setup
4.1 When a tracker loads a game with a linked opponent, the system shall load the opponent team roster from `teams/{opponentTeamId}/players`.

4.2 The system shall allow selecting a subset of opponent players to track.

4.3 The system shall allow adding manual opponent players during tracking even when linked.

### 5. Game Reports & Live Views
5.1 When a game has a linked opponent, the system shall display the linked opponent name and logo where opponent info appears (game report, live game, and tracker UI).

5.2 The system shall display opponent player photos when available (linked roster or cached).

5.3 The system shall retain backward compatibility for games without linked opponent fields.

### 6. Security & Access
6.1 The system shall only write game documents under the current team’s `teams/{teamId}/games` collection.

6.2 The system shall only read opponent players for linked teams; it shall not allow writes to opponent team data.

## Non-Goals (Phase 1)
- Cross-team game sharing or importing.
- Notifications to opponent teams.
- Conflict resolution when both teams track independently.

## Success Metrics
- 80%+ of basketball games with opponents in the system are linked.
- Reduced manual opponent roster entry in tracking flows.
- No increase in Firestore permission errors during tracking.

## Status
- Phase 1 complete (linking + roster preload + live tracker flow).
- Phase 2+ deferred.
