# Architecture Role Output

## Root Cause
`calendar.html` maps ICS type using `ev.isPractice`, but `parseICS()` in `js/utils.js` never sets `isPractice`.

## Minimal Fix
Set `currentEvent.isPractice = isPracticeEvent(value)` when parsing `SUMMARY` in `parseICS()`.

## Why This Layer
- Keeps classification where ICS event objects are constructed.
- Avoids duplicating summary parsing at multiple calendar consumers.
- Preserves existing filter/render behavior without broad refactor.

## Controls and Blast Radius
- No changes to auth, Firestore, or tenant boundaries.
- No persistence model changes.
- Behavioral delta constrained to ICS-derived event type inference.

## Rollback
Revert parser assignment line and corresponding test if regression appears.
