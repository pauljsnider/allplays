## Current State
- `rotationActual` substitution entries are persisted with names only, for example `{ position, out, in, appliedAt }`.
- `buildOnFieldMap()` reconstructs the live lineup by resolving `sub.in` back to a player via `players.find(p => p.name === sub.in)`.
- That is unsafe for duplicate display names and for players renamed after the substitution was recorded.
- Because `rotationActual` is the durable source used to rebuild on-field state after reload, name ambiguity becomes a correctness bug.

## Proposed State
- Keep the existing substitution record shape additive and backward compatible by adding stable player IDs on new writes:
  ```js
  {
      position,
      out,
      outPlayerId,
      in,
      inPlayerId,
      appliedAt
  }
  ```
- Update `buildOnFieldMap()` to resolve substitutions by `inPlayerId` first, then fall back to legacy name lookup only when ID fields are absent.
- Retain `in` and `out` name snapshots for UI and log readability.

## Architecture Decisions
- ID-first, name-second read path fixes the regression without a data migration.
- Backward-compatible dual-write keeps new records safe immediately while old records continue to replay.
- Minimal schema expansion inside existing `rotationActual` entries avoids a new collection or document reshape.
- No Firestore rules or deployment config changes are required.
- Chosen field names are `inPlayerId` and `outPlayerId` for clarity. Read logic also tolerates `inId` if encountered.

## Blast Radius
- `game-day.html`: substitution write path and lineup reconstruction logic.
- `test-game-day.html`: mirrored helper logic and regression coverage.
- Persisted game documents: mixed old and new `rotationActual` entries can coexist safely.

## Risks
- Legacy name-only substitutions remain ambiguous if duplicate names already exist in historical data.
- If an `inPlayerId` points to a missing roster player, reconstruction should fail safe and not guess by name.
- Mixed-format records require explicit regression coverage so fallback behavior does not mask malformed new writes.

## Rollback
- Safe rollback is code-only: revert the ID-first read/write logic and continue ignoring the added fields.
- Added `inPlayerId` and `outPlayerId` fields are additive, so older code ignores them.
- No migration or data cleanup is needed to roll back.
