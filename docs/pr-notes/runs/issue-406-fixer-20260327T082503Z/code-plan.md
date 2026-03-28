Implementation plan:
1. Add the required run notes for requirements, architecture, QA, and code plan.
2. Create a failing unit test suite for a shared practice-save helper that asserts recurring create/edit persistence payloads and page wiring.
3. Implement the new helper by composing `applyPracticeRecurrenceFields(...)` and the add-vs-update persistence branch.
4. Update `edit-schedule.html` to import and call the new helper with existing page state and dependencies.
5. Run focused Vitest coverage for the new suite and existing recurrence payload tests, then stage and commit the fix.

Non-goals:
- No broader refactor of schedule notifications or occurrence editing.
- No UI changes to recurrence controls.
- No unrelated cleanup in the large page script.
