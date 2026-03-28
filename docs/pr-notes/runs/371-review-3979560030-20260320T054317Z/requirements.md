## Requirements role

- Objective: close the loop on PR #371 so the branch reflects both review fixes and passing intent checks.
- Current state: Codex's two functional review findings from commit `a92a8ab840` are already implemented in `1841fed`.
- Gap found during validation: the wiring test still expects `./js/schedule-csv-import.js?v=1` while `edit-schedule.html` imports `?v=2`.
- User-facing risk: low blast radius, but stale coverage would fail the intended regression check and can hide future cache-busting mistakes.
- Recommendation: update the test expectation only; do not reopen the CSV import behavior itself.
