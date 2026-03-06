Objective: prevent schedule editing flows from rewriting saved local practice times as UTC-looking `datetime-local` values.

Current state:
- Practice edit/save is expected to preserve the stored local wall-clock time.
- The page already has a local-input formatter, but schedule editing code is inconsistent about using it.

Proposed state:
- Every scheduling `datetime-local` prefill in scope uses the same local-time formatter before the value is written into the input.

Risk surface and blast radius:
- Scheduling UI only.
- High user impact if wrong because datetime drift silently republishes incorrect practice times.

Assumptions:
- `datetime-local` inputs must always receive local wall-clock strings.
- Existing `formatIsoForInput()` is the canonical helper for this page.

Recommendation:
- Standardize on `formatIsoForInput()` anywhere this page prefills editable schedule datetimes.

Success measure:
- A timezone-focused unit test fails on raw UTC prefill patterns and passes after the helper is used consistently.
