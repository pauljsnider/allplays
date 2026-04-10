# Code Role Plan

## Plan
1. Add a failing unit test for multi-child modal action-state switching.
2. Extract a helper from `js/parent-dashboard-rideshare-controls.js` that returns selected-child rideshare UI state for one offer.
3. Update `parent-dashboard.html` to consume the helper instead of recalculating request/cancel/status state inline.
4. Run focused rideshare tests, then the full unit suite if the targeted run is clean enough.

## Notes
- Requested orchestration skill files and `sessions_spawn` are not available in this environment, so this file records the synthesized code lane output directly.
- Keep the patch minimal and avoid unrelated HTML cleanup.
