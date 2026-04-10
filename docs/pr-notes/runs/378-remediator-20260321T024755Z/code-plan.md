Plan:
1. Remove implicit reconciliation-note insertion from `buildFinishCompletionPlan()`.
2. In `saveAndComplete()`, detect mismatch with a draft plan, prepend the reconciliation note to `state.log`, then rebuild the final plan from the updated log before batching writes.
3. Roll back the temporary log prepend if the batch commit fails.
4. Update unit tests to match the new explicit contract and validate recap inputs still contain the note.
