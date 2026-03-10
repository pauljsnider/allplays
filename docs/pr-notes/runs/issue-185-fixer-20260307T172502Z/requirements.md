Objective: restore the live tracker to the real in-progress period and clock when a coach chooses Continue.

Current state: resume rebuilds stats and lineup, but clock restoration is only as good as the available live event history.
Proposed state: resume uses the most reliable persisted clock source and only falls back to defaults when no valid clock state exists anywhere.

Risk surface:
- Incorrectly preferring stale clock data over newer live events.
- Regressing fresh-start behavior when the coach chooses Cancel instead of Continue.

Assumptions:
- `liveClockPeriod` and `liveClockMs` on the game doc represent the latest canonical tracker state when present.
- Restoring the last known in-progress clock is more important than reconstructing the full event timeline.

Recommendation:
- Prefer live event-derived clock when available and valid.
- Fall back to game doc live clock fields when live events are missing or unusable.
- Keep reset/start-over behavior unchanged.

Success measure:
- Continue resumes at the last persisted period/clock instead of `Q1` / `00:00`.
- Existing resume and reset tests still pass.
