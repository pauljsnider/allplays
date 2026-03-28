## Requirements role summary

- Objective: preserve the viewer behavior from issue #345 while addressing the review finding that `clock_sync` should not incur avoidable collection copies on every heartbeat.
- User-facing requirement: scoreboard fields must still update for late joiners without adding fake play-feed entries or changing visible lineup/stat behavior.
- Acceptance criteria:
  - `clock_sync` updates score, period, and clock.
  - `clock_sync` does not append to `events`.
  - `clock_sync` preserves `events`, `stats`, and `opponentStats` references when unchanged.
  - Real stat events still append to feed and copy only the collections they mutate.
- Risk surface: live and replay viewers that process high-frequency viewer events; blast radius stays limited to `applyViewerEventToState(...)`.

Note: the requested `allplays-requirements-expert` skill was not installed in this environment, so this artifact captures the same decision constraints directly from the repo instructions and review comment.
