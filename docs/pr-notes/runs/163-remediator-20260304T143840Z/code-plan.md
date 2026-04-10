# Code Role Plan

1. Update `expandRecurrence` in `js/utils.js` to precompute consumed recurrence count before `current` when fast-forwarding occurs.
2. Increment recurrence count on rule match independently of visibility window inclusion.
3. Keep occurrence creation conditions (`windowStart`, `exDates`, overrides) unchanged.
4. Run targeted recurrence tests.
5. Stage and commit only scoped files.
