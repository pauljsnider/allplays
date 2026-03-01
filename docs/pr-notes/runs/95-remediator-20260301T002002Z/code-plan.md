# Code Role Plan (manual fallback)

## Implementation Plan
1. Update recurrence day-number math in `js/utils.js` to use `getTime()` day numbers consistently.
2. Ensure weekly interval uses week-start aligned bucket math.
3. Add/verify recurrence tests covering review scenario and prior interval regression.
4. Run focused vitest suite.

## Conflict Resolution Across Roles
- Requirements requested strict minimal scope.
- Architecture requested week-boundary math instead of 7-day start anchoring.
- QA requested explicit regression case (`2026-03-09` exclusion).

Resolution: implement only recurrence-matching math and matching tests, avoid unrelated refactors.

## Tooling Note
Requested `allplays-orchestrator-playbook` and role skills were unavailable in this session environment, and `sessions_spawn` is not an available tool. This run uses a manual four-role synthesis with persisted artifacts to preserve traceability.
