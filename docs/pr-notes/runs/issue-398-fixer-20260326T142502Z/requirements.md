Objective: protect the live viewer lineup workflow against regressions in late-join recovery and lineup/substitution event sync.

Current state:
- Tracker persists and broadcasts `onCourt` and `bench`.
- Viewer stores both arrays but its render path derives bench from roster minus on-court.
- No unit coverage exercises the viewer lineup path.

Proposed state:
- Add focused viewer lineup sync tests for persisted lineup and incoming lineup/substitution updates.
- Treat unknown player ids as non-renderable.
- Preserve configured stat columns on both on-court and bench cards.

Risk surface:
- User-facing live viewer only.
- Blast radius is limited to lineup card rendering and lineup event consumption.
- No Firestore schema or tracker flow changes.

Assumptions:
- Tracker emits complete `onCourt` and `bench` arrays.
- Viewer should respect explicit bench arrays when present instead of reconstructing them.
- Stable roster ordering is preferable for rendered cards.

Recommendation:
- Extract the viewer lineup normalization/rendering logic into a testable helper and keep the page wiring unchanged.

Success:
- New tests fail on current behavior and pass after the fix.
- Existing adjacent viewer/tracker unit tests remain green.
