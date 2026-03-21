Objective: preserve coach-entered final scores when finishing a resumed live game whose in-memory score log is partial or cleared.

Current state:
- `live-tracker.js` already sets `state.scoreLogIsComplete = false` when resuming from persisted live data.
- No automated workflow test proves the finish path keeps the resumed/manual final score instead of reconciling against an incomplete `state.log`.

Proposed state:
- Add automated coverage for resumed finish behavior and cleared-log finish behavior.
- Keep the final-score decision in one helper so the guard stays explicit and reviewable.

Risk surface and blast radius:
- User-facing score corruption at game completion.
- Blast radius is limited to live tracker finalization logic.

Assumptions:
- Unit-level coverage is the viable harness in this checkout; no maintained browser integration harness exists for the finish flow.
- A small helper extraction is acceptable to make the finish path testable without changing UI behavior.

Recommendation:
- Test the finish-score decision directly and assert `live-tracker.js` calls the shared helper.
- Preserve existing behavior for complete score logs while hardening the resumed and cleared-log branches.

Success measure:
- Automated tests prove resumed partial logs and cleared logs keep requested final scores.
- Existing reconciliation behavior still passes for complete logs.
