# Requirements Role Notes

## Objective
Resolve unresolved PR #89 review feedback on recurrence expansion logic in `js/utils.js`.

## Required outcomes
- Daily recurrence honors `interval` via modulo gate instead of unconditional match.
- Daily loop advancement does not double-apply interval jumps.
- Weekly `interval > 1` uses calendar week boundaries so multi-day `byDays` schedules in the same active week are included.
- Changes remain minimal and scoped to recurrence expansion.
