Thinking level: medium
Reason: this is a targeted regression test gap with a narrow runtime branch in a large page module.

Current state:
- `js/live-tracker.js` builds a finish plan, conditionally injects a reconciliation log entry, then writes events/stats/game update.
- `js/live-tracker-finish.js` already owns the pure finish-plan construction.

Proposed state:
- Move the conditional "prepare the plan for save execution" step into `js/live-tracker-finish.js`.
- Keep DOM mutation and rendering in `js/live-tracker.js`, but make the branch decision testable as a pure function.

Why this path:
- Smallest change that gets execution coverage without adding a browser/Firebase harness.
- Preserves current controls and limits blast radius to the finish-flow composition layer.

Controls comparison:
- Current: branch logic is embedded in page code and only source-wiring-tested.
- New: same branch logic is still used by page code, but enforced by unit tests on a pure helper.

Rollback:
- Revert the helper extraction and accompanying test file changes only.
