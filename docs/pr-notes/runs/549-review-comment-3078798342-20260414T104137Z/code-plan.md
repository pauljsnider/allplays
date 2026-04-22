## Root Cause
`resetTeamStatConfigs` used existence-only lookups for both local and shared game assignments. Any historical game with a matching `statTrackerConfigId` looked active to the guard, so reset failed even when only completed games referenced the schema.

## Minimal Patch Plan
1. Add a reset-specific lifecycle helper that treats `completed`, `final`, `cancelled`, and `liveStatus: completed` games as historical and therefore safe for reset.
2. Apply that helper to local team games referenced by `statTrackerConfigId`.
3. Add a reset-specific shared-game helper that reuses the same lifecycle filter for shared assignments.
4. Keep `deleteConfig` unchanged so this PR only narrows the reset workflow.
5. Add focused unit tests for:
   - scheduled local game blocks reset
   - historical local games allow reset
   - scheduled shared game blocks reset
   - completed shared game allows reset

## Files To Change
- `js/db.js`
- `tests/unit/reset-team-stat-configs-guard.test.js`
- `tests/unit/edit-config-schema-workflow.test.js` (validation target only, no change required)

## Validation Commands
- `npx vitest run tests/unit/reset-team-stat-configs-guard.test.js tests/unit/edit-config-schema-workflow.test.js --reporter=dot`
- `npm run test:unit:ci`

## Risks
- Shared-game status semantics are the main edge. The patch assumes completed shared games should behave like completed local games and stop blocking reset.
- Reset still removes schema documents that historical completed games once referenced, so downstream historical rendering must continue relying on stored event data or existing fallbacks.
