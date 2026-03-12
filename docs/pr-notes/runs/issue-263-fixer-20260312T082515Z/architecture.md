Decision: use the existing shared `formatIsoForInput()` helper as the single formatter for editable schedule `datetime-local` fields.

Why this path:
- It matches the already-correct pattern used elsewhere in `edit-schedule.html`.
- It avoids introducing a new date library or changing persistence semantics.
- It reduces duplication in the game edit flow while preserving the narrow blast radius required for a scheduling bug fix.

Controls:
- No Firestore schema changes.
- No recurrence expansion logic changes.
- No changes to how form submission parses `datetime-local`; only prefill formatting is normalized.

Rollback:
- Revert the helper call sites and regression test additions if unexpected UI behavior appears.
