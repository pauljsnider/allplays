# Architecture Role Output (manual fallback)

## Root cause
- `elapsed = (Date.now() - replayStartTime) * replaySpeed` applies *new* speed retroactively to all prior wall-clock replay duration.
- Speed button handler mutates `replaySpeed` but does not rebase `replayStartTime` while playing.

## Proposed design
- Introduce small replay timing helper utilities:
  - elapsed calculation from `(now - start) * speed`
  - start-time rebasing from current replay clock and new speed: `start = now - (clock / speed)`
- On speed click while replay is playing:
  - capture current elapsed under old speed
  - set new speed
  - rebase start time to preserve continuity

## Risk/blast radius
- Localized to replay timing in `live-game` page.
- No Firestore, auth, or rules impact.
- Low regression risk if helper functions are unit tested.
