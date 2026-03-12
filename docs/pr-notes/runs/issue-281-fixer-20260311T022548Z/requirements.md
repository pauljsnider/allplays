Objective: close the analytics gap with the smallest shippable feature slice that still changes user outcomes.

Current state:
- Team admins can only save `name`, `baseType`, and raw `columns`.
- Team and player analytics only summarize existing raw stat keys.

Proposed state:
- Configs can define typed stat definitions for base and derived metrics.
- Derived metrics compute from season totals without changing game-entry flow.
- Team and player analytics can show grouped leaderboards for configured top stats.

User-facing requirements for this run:
- Existing column-only configs must continue to work unchanged.
- Admins need a lightweight way to add derived stats without breaking current config creation.
- Visible player-scope top stats should render automatically on team and player analytics pages.
- Private and team-scope definitions should be stored now, even if only visible player stats render in this slice.

Assumptions:
- Season-level derived metrics are sufficient for the first release; per-game recalculation can remain a follow-up.
- A simple textarea-based config input is acceptable for advanced stat definitions in this issue-fixer lane.
- Formula support can be limited to arithmetic expressions over stat IDs/acronyms with safe evaluation.

Risk surface:
- Config schema changes touch persistence and multiple read paths.
- Formula parsing can create invalid inputs or divide-by-zero cases.
- Existing pages assume `columns` is present and ordered.

Success criteria:
- Column-only configs still power live tracking and reports.
- Derived stat definitions persist with normalized metadata.
- Team and player pages render season leaderboards for configured top stats.
- Unit tests cover normalization, formula calculation, visibility filtering, and ranking behavior.
