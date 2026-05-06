# Code Plan

## Root cause
The source page has `id="teamStatsPanel"` but the opponent stats panel container is missing the expected `id="opponentStatsPanel"`. The baseball test reads `track-live.html` directly and fails on that missing marker.

## Minimal fix
- Add `id="opponentStatsPanel"` to the opponent stats table panel.
- Ensure baseball scorekeeping mode explicitly toggles the team and opponent stats panels hidden, matching the static wiring expectations while keeping the existing generic wrapper behavior intact for goal sports.

## Files
- `track-live.html`
