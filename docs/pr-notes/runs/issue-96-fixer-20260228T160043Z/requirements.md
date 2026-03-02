# Requirements role synthesis (fallback; requested skill unavailable)

## Objective
When a stat-keeper chooses “Continue where you left off”, the tracker must resume at the last persisted game period and clock, not reset to Q1 00:00.

## User-facing acceptance criteria
- Resume path preserves in-game context (period + elapsed clock ms) from persisted live events.
- If no valid persisted period/clock exists, fallback remains Q1 00:00.
- Starting-over path (Cancel) still clears persisted events/stats and starts at Q1 00:00.
- Existing score/stat/opponent resume behavior remains unchanged.

## Risk surface
- Incorrect ordering of live events could pick wrong resume point.
- Non-standard/legacy event payloads may lack usable period/clock.

## Recommendation
Use persisted `liveEvents` as source of truth for period/clock restoration and apply restored period during init rendering.
