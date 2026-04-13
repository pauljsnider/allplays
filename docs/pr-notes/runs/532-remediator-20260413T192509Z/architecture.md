# Architecture

## Current State
- `rotationPlan[period][position]` stores player IDs.
- `rotationActual` substitution replay was updating the live lineup by matching `sub.in` against `state.players.find(p => p.name === sub.in)`.

## Proposed State
- Store additive `outId` and `inId` on new substitution records.
- Replay substitutions into the on-field map by ID first, with legacy name fallback.

## Blast Radius
- Scoped to game-day substitution persistence and reload behavior.
- No schema migration required because the new fields are additive and old records still replay via fallback.

## Controls And Rollback
- Backward compatibility limits risk for existing saved games.
- Rollback is a single-file revert if the live lineup rendering regresses.

## Recommendation
- Keep the patch minimal in `game-day.html` and mirror the logic in `test-game-day.html` so the documented regression case stays covered.
