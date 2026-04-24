# Architecture

## Current State
`tournamentPoolOverrides` uses a slugified pool name as the map key. Different names can collapse to the same key, so persistence and lookup are not one-to-one.

## Proposed State
Use a deterministic readable key composed of the legacy slug plus a stable hash of the exact normalized pool name. Keep a backward-compatible read path that can still find legacy entries by exact stored `poolName`.

## Blast Radius
Low and contained to tournament override persistence and lookup paths in `js/tournament-standings.js` and `js/db.js`.

## Rollback
Revert the keying and cleanup changes if unexpected persistence issues appear. No schema migration is required because the data shape remains a nested object map.