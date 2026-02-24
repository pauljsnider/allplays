# Architecture Role Notes

## Current State
`saveAndComplete` always calls `reconcileFinalScoreFromLog`, assuming in-memory log is complete.

## Proposed State
Gate reconciliation with a trust predicate:
- Derived score from log must equal current live scoreboard (`state.home`, `state.away`).
- Log must contain at least one scoring event.

If predicate fails, preserve requested score.

## Blast Radius
- Limited to finish/save score resolution in two tracker entry points.
- No Firestore schema or API changes.
- Existing substitution integrity behavior unchanged.
