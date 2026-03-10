Objective: Prevent cancelled ICS imports from appearing trackable in `edit-schedule.html`.

Current state:
- Schedule sync treats only `STATUS:CANCELLED` and exact-case `[CANCELED]` as cancelled in `edit-schedule.html`.
- Common variants like `STATUS:CANCELED`, `[CANCELLED]`, and lowercase prefixes remain actionable.

Proposed state:
- Calendar imports normalize cancelled status consistently across status and summary variants.
- Cancelled imported calendar cards render as cancelled and suppress `Track` / practice planning actions.

Risk surface and blast radius:
- Affects imported calendar event classification in team schedule management only.
- Low blast radius if fix stays within calendar import normalization and preserves existing rendering branches.

Assumptions:
- Imported calendar cards rely on `isCancelled` set during `loadSchedule()`.
- Shared helper behavior in `js/utils.js` is the intended normalization contract.

Recommendation:
- Reuse the shared cancellation helper in `edit-schedule.html` and normalize summary cleanup for both prefix spellings.
- Add regression tests for helper behavior and for the HTML source path to prevent duplicate weak logic from returning.

Success measure:
- Cancelled variants are classified as cancelled.
- Imported cancelled cards no longer show `Track` or `Plan Practice`.
