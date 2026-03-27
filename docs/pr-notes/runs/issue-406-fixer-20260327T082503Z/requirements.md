Objective: add durable automated coverage for recurring practice create/edit persistence in `edit-schedule.html`.

Current state:
- The practice form submit handler still owns the add-vs-update branching for practice saves.
- Recurrence payload shaping is partially centralized in `applyPracticeRecurrenceFields(...)`.
- Existing tests verify helper-level recurrence field shaping and static source wiring, but they do not assert the persisted create/edit calls that the schedule form makes.

Proposed state:
- Route recurring practice persistence through a shared helper that receives explicit form-state inputs and save dependencies.
- Add regression tests that assert the saved payload for recurring practice creation and recurring series edit, including the add-vs-update branch.

Risk surface and blast radius:
- Blast radius is limited to the practice submit path in `edit-schedule.html` and a new focused helper in `js/`.
- The user-facing risk is low because the refactor preserves the existing recurrence field helper and only centralizes save branching for testability.
- The main regression risk is accidentally changing non-recurring practice saves while extracting the helper.

Assumptions:
- Vitest unit coverage is the effective automated test framework in this worktree, despite stale repo docs saying otherwise.
- This issue is a test-gap remediation, not a behavior redesign.
- Add/edit recurrence payload parity is the core control to preserve for coaches managing practice series.

Recommendation:
- Extract the save branch into a single helper and test it directly. This is the smallest change that closes the coverage gap with control over payload correctness and minimal UI churn.

Success measures:
- A create-path test proves `addPractice(...)` receives the expected recurring series payload.
- An edit-path test proves `updateEvent(...)` is used, not `addPractice(...)`, and preserves the existing `seriesId`.
- The schedule page source still wires through the shared recurrence payload helper and now also wires through the new save helper.
