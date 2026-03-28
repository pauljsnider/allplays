## Architecture role summary

- Current state: `applyViewerEventToState(...)` eagerly cloned `events`, `stats`, and `opponentStats` before branching on event type.
- Proposed state: keep existing references by default, then allocate shallow copies only on mutation paths:
  - append path clones `events`
  - home stat path clones `stats`
  - opponent stat path clones `opponentStats`
- Why this path: it removes O(n) copying from high-frequency `clock_sync` heartbeats without changing the public helper contract or branching behavior in `live-game.js`.
- Blast radius: one state helper in [js/live-game-state.js](/home/paul-bot1/.openclaw/workspace/worktrees/416-review-4024666605-20260328T033333Z/js/live-game-state.js).
- Rollback: revert the follow-up commit on PR #416 if any viewer regression appears.

Note: the requested `allplays-architecture-expert` skill was not installed in this environment, so this artifact records the architecture decision directly.
