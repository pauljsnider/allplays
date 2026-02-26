# Code Role Plan Synthesis (fallback, no sessions_spawn/allplays skill available)

## Patch plan
1. Update `createDateFromTimeZone` to track seen timestamps and detect oscillation.
2. On oscillation, return deterministic later instant (`Math.max(current, next)`).
3. Add unit regression for `Australia/Sydney` DST-gap input.
4. Validate targeted and full unit test suite.

## Constraints
- Keep API/signatures unchanged.
- No refactor outside ICS parse helper path.
