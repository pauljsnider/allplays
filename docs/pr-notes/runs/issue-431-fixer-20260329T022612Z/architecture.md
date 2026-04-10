# Architecture Role Synthesis

## Current State
- `game-day.html` contains inline RSVP rendering and submit logic.
- `js/db.js` mixes Firestore access with per-player breakdown grouping logic.
- Inline page code is hard to unit test directly.

## Proposed State
- Move Game Day RSVP panel behavior into a small helper module used by `game-day.html`.
- Move per-player RSVP breakdown grouping into a pure helper used by `js/db.js`.

## Why
- Preserves the existing static-page architecture.
- Creates narrow seams for deterministic Vitest coverage.
- Keeps Firebase access in `js/db.js` while isolating business rules for grouping and last-write-wins selection.

## Controls
- No data model changes.
- No Firestore path changes.
- No auth/control changes.
- Blast radius stays within Game Day RSVP rendering and breakdown calculation.
