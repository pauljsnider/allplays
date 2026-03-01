# Code Role Notes

## Minimal Patch
- File: `js/utils.js`
- Replace local weekday calls in weekly interval gating with UTC weekday calls:
  - `seriesStart.getDay()` -> `seriesStart.getUTCDay()`
  - `current.getDay()` -> `current.getUTCDay()`
- Reuse computed UTC day-of-week for both `byDays` mapping and same-day weekly matching.

## Rationale
This preserves existing algorithm shape while removing mixed local/UTC boundary calculations that can include off-cadence dates.
