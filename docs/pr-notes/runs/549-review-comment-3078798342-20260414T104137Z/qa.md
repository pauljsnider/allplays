## Failure Analysis
`resetTeamStatConfigs` previously treated any matching `statTrackerConfigId` as a hard block, both for local team games and shared games. Because neither path filtered on game lifecycle state, completed or otherwise historical games could prevent reset even though the UI copy says only `scheduled or shared games` should block it.

## QA Plan
Minimum proof for this review comment:
1. Reset is **blocked** when a scheduled local game references the config.
2. Reset is **allowed** when only completed, final, cancelled, or `liveStatus: completed` local games reference the config.
3. Reset is **blocked** when an active or scheduled shared game references the config.
4. Reset is **allowed** when only completed shared games reference the config.
5. Existing schema workflow checks still pass so the reset action and error string remain wired into the page.

## Regression Risks
- Narrowing the guard too aggressively could let teams delete configs still needed by active schedule flows.
- Shared-game handling is the sensitive edge. Historical shared games should not block reset, but active shared assignments still must.
- The product still has different semantics between `resetTeamStatConfigs` and `deleteConfig`, since single-config deletion remains broader.

## Validation Matrix
| Scenario | Expected | Result |
|---|---|---|
| Scheduled local game references config | Block reset | Covered by `reset-team-stat-configs-guard.test.js` |
| Completed/final/cancelled local games only | Allow reset | Covered by `reset-team-stat-configs-guard.test.js` |
| Scheduled shared game references config | Block reset | Covered by `reset-team-stat-configs-guard.test.js` |
| Completed shared game only | Allow reset | Covered by `reset-team-stat-configs-guard.test.js` |
| Reset workflow source wiring and message | Still present | Covered by `edit-config-schema-workflow.test.js` |

## Executed Checks
- `npx vitest run tests/unit/reset-team-stat-configs-guard.test.js tests/unit/edit-config-schema-workflow.test.js --reporter=dot`
- `npm run test:unit:ci`
