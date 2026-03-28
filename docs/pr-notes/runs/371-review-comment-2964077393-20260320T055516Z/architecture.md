## Architecture Role

Decision:
- Add a small wrapper around `loadSchedule()` for the CSV import flow instead of changing row persistence semantics.

Why:
- The defect is not Firestore write atomicity inside a row. It is error classification after persistence is complete.
- A refresh-specific helper minimizes blast radius and keeps existing row-level success, warning, and retry behavior intact.

Control comparison:
- Before: refresh failures could mask persisted state and increase duplicate-import risk.
- After: persisted state is acknowledged, retry guidance is explicit, and failed rows remain isolated for retry.

Rejected alternative:
- Full batch rollback. This would require broader persistence changes across game/practice creation and notification follow-up, with significantly larger blast radius.
