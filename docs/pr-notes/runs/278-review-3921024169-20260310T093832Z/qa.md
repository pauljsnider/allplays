Scope:
- Regression around schedule stat-config selection in `edit-schedule.html`.

Checks:
- Assert the helper returns the raw `#statConfig` value and no longer calls `resolvePreferredStatConfigId(...)`.
- Assert add-game submit path stores `statTrackerConfigId: configId || null`.
- Assert calendar-track path stores `statTrackerConfigId: configId || null`.
- Re-run the existing `live-game-state` helper coverage to ensure preferred-config resolution logic remains intact.

Residual risk:
- Tests are source-structure assertions rather than DOM-executed interaction tests. They protect the specific regression but do not simulate the full browser flow.

Acceptance criteria:
- `None` remains persistable for game edit and calendar-track flows.
- Preferred config resolution remains covered in `tests/unit/live-game-state.test.js`.
