# Requirements Role Notes

## Objective
Close PR #103 review comment r2867873198 by preventing invalid numeric UTC offsets from producing parsed dates.

## Current State
`parseICSDate` accepts `DTSTART` numeric offsets via regex and only rejects values where hours > 23 or minutes > 59.

## Proposed State
Reject offsets unless hour is in 0-14 and minute is in 0-59, returning `null` and warning so malformed inputs are dropped.

## Risk Surface and Blast Radius
- Surface: ICS import parsing path in `js/utils.js`.
- Blast radius: limited to events carrying explicit numeric offsets; valid offsets remain accepted.

## Assumptions
- Product requirement for this review item is strict range validation for hour<=14 and minute<=59.
- Existing warning + drop behavior is the desired fail-closed pattern.

## Success Criteria
- Inputs with offsets like `-9999` and `+2599` are dropped.
- Existing valid offset parsing and TZID/UTC parsing tests still pass.
