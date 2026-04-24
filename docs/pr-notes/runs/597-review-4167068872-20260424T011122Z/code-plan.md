# Code Plan

## Root Cause
`buildTournamentPoolOverrideKey` used a lossy slug. That same slug was reused for save, clear, and read paths, so multiple distinct pool names could address the same storage location.

## Minimal Patch Plan
- Replace the lossy key with a slug-plus-hash key derived from the exact normalized pool name.
- Add backward-compatible exact-name fallback when reading legacy overrides.
- When saving or clearing, fetch current overrides and only delete entries whose stored `poolName` exactly matches the target pool.

## Tests
- Add unit coverage for unique keys across colliding pool names.
- Add unit coverage proving isolated overrides for colliding legacy slugs.
- Add unit coverage for legacy exact-name fallback and persistence cleanup wiring.

## Risks
Previously collided legacy data may already be ambiguous. New writes and exact-name cleanup stop the corruption from continuing.