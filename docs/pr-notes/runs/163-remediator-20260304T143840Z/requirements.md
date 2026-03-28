# Requirements Role Notes

- Objective: Resolve PR thread `PRRT_kwDOQe-T585yEy7G` by preventing finite recurrence series from generating instances after their `recurrence.count` is already exhausted.
- Current behavior: `expandRecurrence` fast-forwards old series to `windowStart`, but `generated` starts at 0, so count termination only reflects post-window occurrences.
- Required behavior: count-based recurrence must terminate based on total matched recurrence instances since series start, not just those iterated in the visible window.
- Scope: Minimal change in `js/utils.js` recurrence expansion logic only.
- Assumptions: `count` applies to recurrence matches globally (series lifespan), and visibility/exclusions should not reset count progression.
