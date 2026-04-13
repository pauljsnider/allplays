# Code Plan

## Likely Files To Change
- `js/stat-config-presets.js`
- `js/db.js`
- `edit-config.html`
- `edit-team.html`
- `tests/unit/stat-config-presets.test.js`
- `tests/unit/edit-config-schema-workflow.test.js`
- `tests/unit/edit-team-stat-schema-defaults.test.js`
- `tests/smoke/edit-config-platform-admin.spec.js`

## Exact Implementation Steps
1. Add a shared preset catalog and serialization helper for editable advanced stat definitions.
2. Add `updateConfig` and guarded `resetTeamStatConfigs` to the db layer.
3. Expand `edit-config.html` to support preset apply, import from owned teams, edit existing configs, and schema-only reset.
4. Reuse the shared preset catalog in `edit-team.html` for new-team default config seeding.
5. Add focused unit coverage and extend the existing edit-config smoke spec.

## Helpers/Data To Add
- Shared preset definitions for blank, basketball, soccer, baseball, football, and volleyball.
- `getStatConfigPresetOptions`, `getStatConfigPresetById`, `getDefaultStatConfigForSport`, and `serializeAdvancedStatDefinitions`.
- DB helpers for update and guarded reset.

## Likely Failure Modes
- Reset deletes configs still referenced by scheduled or shared games.
- Import leaks schemas from teams outside the owner scope.
- Edited column order drifts from downstream tracker/report consumers.
- Shared preset logic diverges between edit-config and edit-team if not centralized.

## Minimal Validation Steps
- Run targeted Vitest coverage for new preset and edit/reset behavior.
- Exercise existing stat leaderboard and config delete-guard unit tests.
- Run the existing edit-config smoke spec when browser dependencies are available.
