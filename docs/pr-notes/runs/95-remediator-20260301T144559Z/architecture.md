# Architecture Role Notes

## Current state
`expandRecurrence` iterates dates via local `setDate/getDate` but still used UTC-derived fields (`getUTCDay`, ISO date from `toISOString`) for recurrence matching and instance keys.

## Proposed state
Use one coherent local-time basis for recurrence iteration and matching:
- day number via `getTime()/MS_PER_DAY`
- day-of-week via `getDay()`
- week anchor via local day-of-week subtraction
- `instanceDate` key via local YYYY-MM-DD formatter

## Risk and blast radius
- Scope is confined to `expandRecurrence` in `js/utils.js`.
- Main behavior shift affects edge cases around timezone offsets/DST boundaries and week-interval gating.
