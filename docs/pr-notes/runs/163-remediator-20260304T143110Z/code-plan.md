# Code role notes

- Orchestration note:
  - Requested `allplays-orchestrator-playbook` and role skills were not available in this environment, so inline role analysis was performed.
- Implementation plan:
  1. Update `js/utils.js` in `expandRecurrence`:
     - After jump to `windowStart`, re-align weekly cursor week parity against series anchor.
     - Replace iteration cap formula with traversal-length + safety margin.
  2. Update `tests/unit/recurrence-expand.test.js`:
     - Replace loose long-running assertion with exact expected in-window dates and count.
  3. Run targeted test file and commit.
