Decision: keep `buildFinishCompletionPlan()` focused on score reconciliation and write generation, and move the reconciliation log insertion to the caller before the final plan is assembled.

Why:
- The blast radius stays inside the finish flow.
- The source of truth for persisted events and recap content becomes the same explicit log list used by `saveAndComplete()`.
- Failure handling can roll back the temporary log prepend if the batch commit fails.
