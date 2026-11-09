# Architecture analysis

## Root cause

`js/live-tracker.js` uses the single-substitution helpers while the shared integrity module already exposes projected queue validation. The parallel basketball tracker is wired to those queue helpers, but the live tracker is not.

## Minimal design

- Import `canApplySubstitutionQueue` and `canApplyQueuedSubstitution` from `js/live-tracker-integrity.js`.
- Centralize pending validation in the live tracker so quick mode uses current-lineup validation and queue mode uses projected validation.
- Reject an invalid whole queue at the start of `applyQueue()` before any mutation or side effect.
- Keep the queue intact on rejection so the operator can correct it.

## Risk

The shared helpers are already covered and used by `js/track-basketball.js`, which limits algorithmic risk. The principal integration risk is failing to wire both queue insertion and application paths in the live tracker.
