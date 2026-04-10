Objective: Make live-game player stat sections reflect stat undo and removal actions from `track-live.html`.

Current state:
- `track-live.html` updates in-page stats and score during undo/remove.
- It publishes an `undo` system event with refreshed score.
- It does not publish the matching negative `stat` event needed for the viewer to decrement player sections.

Proposed state:
- Keep the existing `undo` system event for play-by-play clarity.
- Also publish a reverse `stat` live event for stat undos and removals so the viewer can reconcile player totals in real time.

Risk surface:
- Affects only track-live live event publishing for stat undo/remove.
- No Firestore schema changes.
- Low blast radius because the viewer already consumes `stat` events.

Assumptions:
- The live-game viewer is expected to update player stat sections from incremental `liveEvents`.
- `track-live` stat keys already match the viewer's existing stat handling for positive events.

Recommendation:
- Add the missing reverse stat broadcast in both stat undo and stat remove flows.
- Cover it with a unit test that fails on the missing event contract.
