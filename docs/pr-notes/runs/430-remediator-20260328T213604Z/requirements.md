Objective: fix PR thread `PRRT_kwDOQe-T5853e7ZS` in `track-live.html`.

Current state: `undoLogEntry` subtracts the logged stat value locally with a zero clamp, but always emits `-parsedValue` to live viewers.
Proposed state: emit the actual applied undo delta after clamping so remote totals match the local tracker state.

Risk surface: live stat event consumers and score updates for point-like stats.
Blast radius: limited to the undo path in `track-live.html`.

Assumptions:
- Live viewers apply `event.value` directly to running totals.
- Undo should not force remote totals below zero when the local tracker did not.

Recommendation: compute `appliedDelta = currentVal - newVal`, use it for score rollback, and publish `-appliedDelta`.
