# Issue 377 Architecture

## Decision
Move live-tracker finish/save decision logic into a pure helper module consumed by `js/live-tracker.js`.

## Current State
- `saveAndComplete()` mixes input parsing, score reconciliation, Firestore payload construction, and navigation side effects in one function.
- That coupling blocks realistic automated validation of the persisted payload.

## Proposed State
- New helper module returns a finish completion plan:
  - reconciled final score
  - event write payloads
  - aggregated stat write payloads
  - game update payload
  - navigation plan for direct redirect or mailto-then-redirect
- `live-tracker.js` remains responsible for executing Firestore writes and DOM updates.

## Blast Radius
- Limited to the live tracker finish path.
- No schema changes.
- No change to Firestore collection layout or routing destinations.

## Controls
- Preserve existing write order: batch commit, end live broadcast, then navigation.
- Keep recipient resolution in `live-tracker.js` so existing email wiring remains explicit at the page layer.
