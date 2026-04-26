# Architecture Role Artifact

## Current State
`tournament-standings.js` builds division-scoped group names such as `10U Gold • Pool A`. `tournament-brackets.js` previously matched pool-seed slots using only the slot object, so a slot with `{ poolName: 'Pool A', seed: 1 }` did not match the scoped key when `divisionName` was stored on `game.tournament`.

## Proposed State
Use a context-aware pool label helper in `js/tournament-brackets.js`:
- slot provides `poolName`, `seed`, and optional slot-level division fields.
- tournament/game context provides fallback `divisionName` or `division`.
- resulting labels use the same `Division • Pool` format as standings.

## Architecture Decisions
- Keep persisted tournament data shape unchanged.
- Apply contextual label resolution to seed collection, standings index construction, pool-seed team resolution, and preview source labels.
- Preserve legacy unscoped matching by falling back to the slot-only pool label when no division context exists.

## Blast Radius
Limited to tournament bracket advancement helpers and their unit coverage. No auth, Firestore rules, deployment config, or schema changes.

## Rollback
Revert the helper signature/usage changes in `js/tournament-brackets.js` plus the focused unit regression test. No data rollback required.
