Objective: Keep basketball teams in the basketball tracker chooser flow when a referenced stat config exists but does not declare `baseType`.

Current state:
- `edit-schedule.html` treats any found config as authoritative.
- If `config.baseType` is missing, basketball detection returns `false`.
- The Track flow then opens the generic path instead of exposing the basketball chooser.

Proposed state:
- A config only overrides team-sport inference when it has a usable `baseType`.
- Missing or empty `baseType` falls back to the team sport.

Risk surface and blast radius:
- Affects tracker routing from schedule cards and calendar-originated tracking on `edit-schedule.html`.
- Blast radius is limited to basketball detection for configs missing `baseType`.

Assumptions:
- Legacy or incomplete config records without `baseType` can still exist in production.
- Team sport remains the correct fallback when config type metadata is absent.

Recommendation:
- Apply a minimal helper fix and add a regression test in `test-pr-changes.html`.

Success measure:
- The regression test for config-without-`baseType` passes.
- Existing basketball and non-basketball detection cases continue to pass.
