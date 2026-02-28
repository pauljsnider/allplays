# Architecture role synthesis (fallback; requested skill unavailable)

## Current state
- `init()` resets `state.period='Q1'` and `state.clock=0`.
- Resume reconstruction reads `liveEvents` only for some score/opponent backfill logic.
- UI init unconditionally calls `setPeriod('Q1')`, overriding any restored state.

## Proposed state
- Add a small pure helper for resume-state derivation from persisted live events.
- In resume path, always fetch `liveEvents`, derive latest valid period/clock, and apply to `state`.
- Replace `setPeriod('Q1')` with `setPeriod(state.period)`.

## Blast radius
- Limited to live tracker resume flow (`js/live-tracker.js`) + new helper module + unit tests.
- No Firestore schema/rules changes.

## Control equivalence
- Does not increase data access surface; uses already-read game-scoped events.
- No change to auth/tenant boundaries.
