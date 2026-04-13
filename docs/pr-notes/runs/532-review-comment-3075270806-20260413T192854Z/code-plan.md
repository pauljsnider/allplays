## Root Cause
- `buildOnFieldMap()` in both `game-day.html` and `test-game-day.html` replayed `rotationActual` by resolving `sub.in` with `players.find(p => p.name === sub.in)`.
- `applySub()` persisted only player names in `rotationActual`, so saved substitutions depended on mutable, non-unique display names.
- That breaks substitution reconstruction after reload when two players share a name or when a player has been renamed.

## Minimal Patch Plan
- In `applySub()`, keep the current human-readable fields, but also persist stable IDs:
  - `outPlayerId: outPlayer.id`
  - `inPlayerId: inPlayer.id`
- Update `buildOnFieldMap()` to apply subs by stable ID first:
  - `const nextPlayerId = sub.inPlayerId || sub.inId || players.find(p => p.name === sub.in)?.id;`
- Keep the name lookup only as a backward-compatible read fallback for older `rotationActual` entries stored without IDs.
- Do not add a migration. New writes become safe immediately and old records continue to replay.

## Test Updates
- Update the current substitution reload assertion to use a stored `inPlayerId`.
- Add duplicate-name regression coverage where two players share the same `name` and the persisted `inPlayerId` must keep the intended player on the field.
- Add renamed-player regression coverage where persisted `inPlayerId` must still resolve after the player object's current `name` differs from stored `sub.in`.
- Keep one legacy coverage case proving old name-only `rotationActual` entries still work via fallback.

## Validation Commands
```bash
git diff -- game-day.html test-game-day.html docs/pr-notes/runs/532-review-comment-3075270806-20260413T192854Z
node .tmp-run-test-game-day.cjs
git status --short
```

## Commit Scope
- `game-day.html`
  - Persist `inPlayerId` and `outPlayerId` on new substitution writes.
  - Resolve actual substitutions with ID-first, name-fallback logic.
- `test-game-day.html`
  - Mirror the ID-first helper behavior.
  - Add regression tests for duplicate names, renamed players, and legacy name-only records.
- `docs/pr-notes/runs/532-review-comment-3075270806-20260413T192854Z/*`
  - Persist run-scoped requirements, architecture, QA, and code-plan notes for traceability.
- No schema migration, build-step change, or unrelated refactor.
