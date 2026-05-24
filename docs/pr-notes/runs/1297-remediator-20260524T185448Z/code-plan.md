# Code Plan

- In applyPracticeRecurrenceFields, replace property deletion with practiceData[fieldName] = deleteField() for existing practice edits where recurrence is disabled.
- Update the unit test expectations to require the sentinel for every recurrence-only field.
- Commit only the targeted source/test changes and required review-remediator notes.
