# Architecture Role Notes

## Current State
`init()` in `js/live-game.js` requests players during initial `Promise.all` load. Prior implementation passed an options object on every call.

## Proposed State
Build a conditional players promise:
- Replay: `getPlayers(state.teamId, { includeInactive: true })`
- Live/active: `getPlayers(state.teamId)`

## Blast Radius
Low. One call-site in `live-game.js`; no data model or API changes. Behavior aligns with existing `getPlayers` semantics and keeps active workflows filtered.
