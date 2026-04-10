# Code Role Plan

## Minimal Patch
1. Add reusable `MS_PER_DAY` constant in `js/utils.js`.
2. Precompute series UTC day and series week start UTC day.
3. Replace `Math.floor(daysSinceSeriesStart / 7)` weekly gate with week-start delta gate.
4. Add a unit regression in `tests/unit/recurrence-expand.test.js` for `byDays: ['MO','WE']`, `interval: 2`, start on Wednesday.

## Safety
- No API surface changes.
- No persistence or network changes.
- Existing tests around recurrence remain as guardrails.
