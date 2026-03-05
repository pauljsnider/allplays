# Architecture Role (allplays-architecture-expert)

## Decision
Use local classifier helpers inside `pickBestGameId`:
- normalize `status` and `liveStatus`
- classify `cancelled`
- classify `completed` from either field

Apply completed filtering only to scheduled-future branch.

## Tradeoffs
- Pro: Minimal, isolated patch; preserves existing fallback behavior for recent games.
- Con: Logic remains local to page script (not centralized utility), but avoids risky refactor in PR lane.

## Control Equivalence
- No auth/rules/data-model changes.
- No multi-tenant or PHI access-path changes.
