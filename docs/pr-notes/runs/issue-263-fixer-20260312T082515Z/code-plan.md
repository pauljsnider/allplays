Implementation plan:
1. Replace duplicated `datetime-local` formatting in `startEditGame()` with the shared `formatIsoForInput()` helper for consistency.
2. Upgrade the practice timezone regression from source inspection to executable behavior checks under a non-UTC timezone.
3. Validate with focused and full unit runs.
4. Commit the targeted fix and tests with an issue-referencing message.
