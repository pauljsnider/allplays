# Architecture Role (Fallback Synthesis)

## Tooling status
Requested skill `allplays-architecture-expert` and `sessions_spawn` are not available in this runtime; this file records equivalent architecture analysis.

## Current state
`expandRecurrence()` iterates `current` using local `Date` operations (`setDate/getDay`) but derived day numbers via `Date.UTC(year, month, date)`.

## Proposed state
Derive both `seriesStartDayNumber` and `currentDayNumber` using epoch time from the same `Date` objects (`Math.floor(date.getTime() / MS_PER_DAY)`), keeping arithmetic basis consistent.

## Risk surface and blast radius
- Affects only `js/utils.js` recurrence expansion logic.
- Potential impact confined to weekly interval matching.
- No schema, API, or Firestore/security changes.

## Rollback
Revert the two updated lines in `expandRecurrence()` if regression appears.
