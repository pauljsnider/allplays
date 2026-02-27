# Architecture Role Analysis (manual fallback)

## Current state
Resume path initializes opponent `stats` with `statDefaults(currentConfig.columns)` and copies only configured columns from `game.opponentStats`, omitting `fouls`.

## Proposed state
Centralize opponent stat hydration in a pure helper:
- Start from defaults (`time: 0`, `fouls: 0`, configured columns).
- Copy configured columns from persisted data when defined.
- Copy persisted `fouls` when defined.

Use helper in resume flow to avoid drift and make behavior unit-testable.

## Controls equivalence
- Data shape remains identical.
- Existing defaulting behavior preserved.
- Only additive copy of an already persisted field (`fouls`).

## Rollback plan
Revert helper usage and restore prior inline mapping if regression appears.
