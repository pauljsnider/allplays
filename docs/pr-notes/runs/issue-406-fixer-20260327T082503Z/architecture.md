Objective: make the recurring practice save path testable without broad changes to `edit-schedule.html`.

Current architecture:
- `edit-schedule.html` is a large page-level module with inline form submit handlers.
- `applyPracticeRecurrenceFields(...)` centralizes recurrence-only payload shaping but not persistence branching.
- The decision to call `addPractice(...)` or `updateEvent(...)` still lives inline in the practice submit handler.

Root cause:
- The remaining untested logic is split between inline page state and persistence calls, which makes direct regression assertions awkward and fragile.
- Because the branch is inline, current tests stop at static source checks rather than verifying the saved payload contract.

Proposed change:
- Add `savePracticeForm(...)` in a new helper module that accepts practice state, recurrence state, Firestore helpers, and persistence functions.
- Keep `applyPracticeRecurrenceFields(...)` as the recurrence payload authority and have the new helper compose it.
- Update the practice submit handler to delegate the save branch to the new helper, then keep notification handling in-page.

Why this path:
- One-source save-path logic with explicit dependencies is easier to test and review than extracting DOM-heavy browser harness code.
- Control equivalence is preserved because the same inputs still produce the saved payload; only the orchestration point moves.

Controls and rollback:
- The rollback path is a single helper revert plus restoring the previous inline save branch.
- The new tests reduce future blast radius by locking the add/update contract and recurring payload shape together.
