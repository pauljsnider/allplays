## QA Plan

1. Verify the `edit-team.html` import regression is fully contained to the AsyncFunction unit harness and no runtime behavior changed.
2. Verify `resetTeamStatConfigs` now blocks only active assignments, not historical completed/final/cancelled ones, for both local and shared games.
3. Confirm reset behavior still matches UI copy on `edit-config.html`, while noting `deleteConfig` intentionally remains stricter.

## Affected tests / manual checks

### Automated
- `tests/unit/edit-team-admin-access-persistence.test.js`
  - Must rewrite the new `./js/stat-config-presets.js?v=1` import before `new AsyncFunction(...)`.
  - Minimal stub for `getDefaultStatConfigForSport()` is sufficient.
- `tests/unit/reset-team-stat-configs-guard.test.js`
  - Covers scheduled vs historical local games.
  - Covers scheduled vs completed shared games.
  - Covers `completed`, `final`, `cancelled`, and `liveStatus: completed` as reset-safe history.
- `tests/unit/edit-config-schema-workflow.test.js`
  - Confirms reset wiring/message still exists on `edit-config.html`.

### Manual
- `edit-team.html` new-team flow:
  - Create a team with a sport that has a preset.
  - Save succeeds and default stat config is created.
- `edit-config.html` reset flow:
  - Reset blocked when config is referenced by a scheduled/local game.
  - Reset blocked when config is referenced by a scheduled/shared game.
  - Reset allowed when only completed/final/cancelled local games reference it.
  - Reset allowed when only completed shared games reference it.

## Likely regression risks

1. **Harness fragility**
   - The edit-team unit test still depends on exact import-string replacement, so future import additions or cache-bust version changes can break CI again even if app behavior is fine.

2. **Status taxonomy drift**
   - Reset safety depends on status classification. If new lifecycle values are introduced later, reset could become too strict or too permissive.

3. **Behavior mismatch with delete**
   - `resetTeamStatConfigs` is now narrower, but `deleteConfig` still blocks any historical reference. That is acceptable for this fix, but it is an easy future confusion point.

## Minimal validation matrix

| Area | Scenario | Expected |
|---|---|---|
| edit-team harness | unit harness loads page module with new preset import | no `Cannot use import statement outside a module` |
| edit-team runtime | create new team with preset-backed sport | save succeeds, default config created |
| reset local active | scheduled/local game references config | reset blocked |
| reset local history | completed/final/cancelled/local game references config | reset allowed |
| reset shared active | scheduled/shared game references config | reset blocked |
| reset shared history | completed/shared game references config | reset allowed |

## QA readout

- Thread 1 looks addressed by the harness rewrite plus stub. Risk is low in product behavior, medium in future CI brittleness.
- Thread 2 looks aligned with the review comment. The main residual QA concern is status classification edge cases, not the core scheduled-vs-history logic.
