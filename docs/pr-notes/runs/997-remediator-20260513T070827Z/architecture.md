# Architecture notes

Decision:
- Track summary-save in-flight state locally inside `setupSummaryControls` with a boolean guard.
- Derive `saveBtn.disabled` from that guard in `openEditor`, `closeEditor`, and save completion paths.

Blast radius:
- Single-page DOM behavior only. No Firestore schema, rules, or shared module changes.
