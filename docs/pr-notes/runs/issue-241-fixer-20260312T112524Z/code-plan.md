Implementation plan:
1. Add a failing unit test in `tests/unit/live-tracker-resume.test.js` for legacy persisted game clock fields.
2. Update `js/live-tracker-resume.js` to normalize current and legacy persisted clock field names.
3. Run the focused unit test, then run a broader live-tracker-related unit slice if needed.
4. Commit the fix and test together with an issue-referencing message.
