# Architecture Notes

## Context
CI fails in `tests/unit/track-live-baseball.test.js` because `track-live.html` no longer exposes the expected opponent stats panel identifier.

## Decision
Keep the existing static-page architecture and restore explicit DOM panel identities for the generic team/opponent stats tables. This preserves the current baseball scorekeeping mode behavior while making each panel addressable for tests and future UI control.

## Scope
- Add `id="opponentStatsPanel"` to the opponent stats panel container.
- Keep changes inside `track-live.html` only unless validation shows test-only drift.

## Risks and rollback
Low risk. The change is an additive DOM ID and a targeted visibility wiring adjustment. Roll back by reverting the single commit if unexpected UI behavior appears.
