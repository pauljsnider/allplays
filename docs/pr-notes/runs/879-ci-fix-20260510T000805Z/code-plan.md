# Code Plan

Implementation Plan
- Update `tests/unit/parent-dashboard-rsvp-controls.test.js` line 196 to expect the current source snippet using `event.childIds`.
- Do not alter production code because the current implementation already emits the grouped child IDs dataset.

Validation
- `npx vitest run tests/unit/parent-dashboard-rsvp-controls.test.js`
- `npm test`

Conflict Resolution
- Role subagent execution was unavailable in this runtime, so analysis was performed inline using the ALL PLAYS orchestrator playbook.
