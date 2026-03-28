Objective: address PR #378 thread `PRRT_kwDOQe-T58512Pdm` with the smallest code change that preserves persisted finish-state evidence.

Current state:
- `saveAndComplete()` builds `finishPlan` from `state.log`.
- The visible reconciliation note is added later with `addLog(...)`.

Required state:
- If the trusted score log overrides the typed final score, the reconciliation explanation must already be present in the log used to build event writes and recap email content.

Acceptance:
- Completed-game event writes include the reconciliation note.
- Email recap generation during finish includes the reconciliation note.
- No duplicate reconciliation entry is added to the runtime log.
