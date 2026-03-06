Objective: address PR thread `PRRT_kwDOQe-T585ytQQB` by preventing live game updates from reloading the active video stream or replay.

Current state:
- `handleGameUpdate` runs on every `subscribeGame` snapshot.
- Each snapshot calls `setupVideoPanel`, which recalculates playback and may rewrite `iframe.src` or `video.src`.

Required change:
- Only reinitialize the video panel when the resolved playback mode or source actually changes.
- Keep the change scoped to the review comment and preserve existing live-game update behavior.

Success criteria:
- Score/clock/status snapshots no longer reset active playback.
- Real playback changes still swap the player source correctly.
