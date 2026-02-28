# Architecture Role Notes (fallback, no allplays-orchestrator-playbook skill available)

## Current State
- `getPlayers` already supports `{ includeInactive }`.
- `deletePlayer` currently hard-deletes player doc via Firestore `deleteDoc`.
- Historical views currently use active-only roster lookup.

## Proposed Minimal Change
1. Convert `deletePlayer` to soft-delete update (`active=false`, `deactivatedAt`, `updatedAt`).
2. Update historical callsites only:
   - `game.html`
   - `player.html`
   - `js/live-game.js`
   - `team-chat.html`
3. Keep active roster callsites unchanged.
4. Add explicit roster-management copy clarifying delete semantics.

## Blast Radius
- Low schema risk (no migration).
- Moderate UI behavior impact on historical rendering only.
