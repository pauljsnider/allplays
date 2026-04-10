# Issue #440 Architecture Synthesis

## Current State
- `js/live-tracker.js` assembles the finish plan, mutates UI state, writes the batch, calls `endLiveBroadcast()`, and executes navigation in one function.
- `js/live-tracker-finish.js` already isolates plan construction, including score reconciliation and navigation planning.

## Proposed State
- Introduce a narrow helper module for the executable finish workflow.
- Keep `saveAndComplete()` as the entrypoint in `js/live-tracker.js`.
- Move only the workflow body that depends on lock state, inputs, Firestore writes, and navigation into the helper.

## Blast Radius
- Low. One live tracker call site changes to delegate to a helper.
- No Firestore schema changes.
- No HTML changes.
- No behavior changes intended outside improved testability.

## Control Equivalence
- Single-flight lock remains the first gate.
- Button disabling remains tied to the in-flight submission.
- Batch commit, completion status update, and navigation order remain unchanged.
- Error recovery still re-enables the button, releases the lock, and removes the temporary reconciliation log entry.

## What Would Change My Mind
- If importing a helper causes browser-only dependencies to leak into the test runtime.
- If the extracted seam requires broad state reshaping instead of a narrow dependency object.
