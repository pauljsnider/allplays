Objective: cover the coach-facing calendar import path in `edit-schedule.html`, including calendar-link validation, imported event merge behavior, and duplicate suppression against tracked ICS events and existing DB events.

Current state:
- `edit-schedule.html` contains the add-calendar form behavior and the schedule merge logic inline.
- Existing automated coverage exercises `window.trackCalendarEvent(...)` after import, not the import path itself.

Proposed state:
- Shared helper(s) own the `.ics` URL validation and imported calendar merge rules.
- Unit tests assert the helper behavior and the page wiring so regressions fail in CI.

Risk surface and blast radius:
- Affects schedule import on `edit-schedule.html` only.
- Blast radius stays limited if the patch is confined to helper extraction plus page wiring.

Assumptions:
- Repo-standard automated coverage is Vitest unit tests, not Playwright, in this worktree.
- Preserving existing UI copy and rendering branches is preferable to broader refactoring.

Recommendation:
- Extract the import logic to a small pure module and test the business rules directly.
- Add source-wiring assertions in `edit-schedule.html` for the add-calendar save path and the import merge path.
