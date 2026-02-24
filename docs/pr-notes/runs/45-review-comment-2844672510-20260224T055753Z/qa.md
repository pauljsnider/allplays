# QA Role Summary

## Regression targets
- `saveAndComplete` in `live-tracker.js` and `track-basketball.js`.
- Resume path state reconstruction from `aggregatedStats`/`liveEvents`.
- Log clear behavior before finalization.

## Validation checklist
- Fresh game session: scoring events logged end-to-end; reconciliation still allowed when log matches live score.
- Resumed game with existing persisted data: reconciliation path blocked; entered/requested final score is preserved.
- Clear log then continue: reconciliation remains blocked.
- Undo flow: `scoreLogIsComplete` survives state snapshot restoration.

## Guardrail rationale
Prefer false-negative reconciliation (skip overwrite) over false-positive overwrite (data loss).
