Objective: remove basketball-only live scoring defaults so non-basketball games keep sport-correct phase labels through start, reset, resume, and viewer flows.

Current state:
- `track-live.html` partially adapts period labels for soccer and can read config-defined periods.
- `js/live-tracker.js`, `js/live-tracker-reset.js`, `js/track-live-state.js`, and `js/live-game-state.js` still fall back to `Q1`.
- That creates a broken experience for soccer/baseball after reset/replay/resume even when the tracker UI or config implies a different sport model.

Proposed state:
- Introduce one shared sport-profile helper that resolves the default phase label from sport and optional config periods.
- Use that helper anywhere live state is initialized or reset.

User value:
- Soccer live scoring resumes at `H1` instead of `Q1`.
- Baseball/softball live scoring can initialize and reset to inning-based labels instead of basketball quarters.
- Viewer and tracker remain aligned after reset/replay.

Assumptions:
- The smallest safe fix for issue #205 in this pass is correcting sport-specific default tracker state, not shipping full baseball count/base-runner UI.
- Existing arbitrary stat-column support in `track-live.html` remains the primary non-basketball stat model.
- Configs may optionally provide `periods`, which should override sport defaults when present.

Success criteria:
- Unit tests prove soccer/baseball defaults no longer fall back to basketball labels.
- No regression in existing basketball reset/resume behavior.
