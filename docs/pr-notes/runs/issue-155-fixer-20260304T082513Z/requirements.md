# Requirements Role Synthesis

## Objective
Fix live tracker and live viewer regressions for generic (non-basketball-specific) game tracking UX and state sync.

## User-facing requirements
- Reset in `track-live.html` must also reset what viewers see in `live-game.html` without requiring a page refresh.
- Foul stat label/value (`FLS`) must only appear when configured as a trackable column.
- Opponent name must display reliably from linked-opponent fields.
- Remove basketball-specific wording in live viewer UI (`On Court`, basketball icon, `Lineup not set`).
- Team stats table in `track-live.html` needs a status control (`On Field` / `Bench`) and tracked time-on-field.
- Modernize theme of `track-live.html` (visual only, no behavior changes outside requested items).

## Constraints
- Keep changes minimal and compatible with existing Firestore structures.
- Preserve existing event logging behavior.
- Avoid introducing sport-specific assumptions in generic tracker.
