# Architecture

## Decision
Use stored pre-action volleyball state for undo rather than trying to infer the reverse transition.

## Design
- Capture `before` state before applying a volleyball outcome: `homeScore`, `awayScore`, `servingTeam`, and `period`.
- Store `before` and `after` in the log row `undoData` for volleyball entries.
- Add a volleyball branch in `undoLogEntry()` that restores from `undoData.before`, refreshes UI, syncs the game document, and broadcasts an undo live event.
- Guard volleyball undo to newest entry only. Older volleyball log deletion is order-dependent because later serve outcomes depend on prior serving team.

## Blast Radius
- Touches live volleyball scorekeeping only plus pure helper tests.
- No Firestore schema or rules change.
- Existing stat undo branch remains unchanged.
