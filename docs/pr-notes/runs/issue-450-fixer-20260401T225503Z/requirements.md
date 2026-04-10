Objective: prevent finish-flow regressions from overwriting a coach-entered final score when a resumed live tracker has an incomplete score log.

Current state:
- Helper tests cover score reconciliation rules.
- No execution-level test covers the `saveAndComplete()` branch that decides whether reconciliation is allowed.

Proposed state:
- Add a regression test around the finish-flow execution seam that preserves entered scores when `scoreLogIsComplete` is `false`.
- Assert the flow still persists `status: 'completed'` and does not append a reconciliation note.

Risk surface:
- User-visible final score on completed games.
- Audit trail pollution if a false reconciliation note is added.
- Low blast radius if fixed in the finish-flow helper path only.

Assumptions:
- Resumed persisted games intentionally mark `scoreLogIsComplete = false`.
- Partial score logs are expected and must not be trusted at completion.
- Existing helper behavior is correct; the gap is runtime coverage around the save wrapper.

Recommendation:
- Extract the small reconciliation-and-log-entry step out of `saveAndComplete()` into a pure helper in `js/live-tracker-finish.js`.
- Cover the resumed incomplete-log scenario there and keep the page flow behavior unchanged.

Success measure:
- A test fails if finish flow ever reconciles or logs reconciliation when `scoreLogIsComplete` is false.
- Targeted unit tests pass with no unrelated behavior changes.
