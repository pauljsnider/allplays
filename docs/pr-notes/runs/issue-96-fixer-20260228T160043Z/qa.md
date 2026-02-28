# QA role synthesis (fallback; requested skill unavailable)

## Primary regression to guard
Resume path must not reset to Q1 00:00 when persisted events indicate later period/clock.

## Unit test plan
- New helper test: choose latest valid event by `createdAt`; restore `period` + `gameClockMs`.
- Fallback test: when no valid period/clock exists, return defaults Q1/0.
- Robustness test: still restore using progression fallback when timestamps unavailable.

## Manual sanity checks
- Reproduce issue flow in browser: track into Q3 with running clock, reload, choose resume, verify period/clock retained.
- Start-over path still wipes events and starts at Q1 00:00.
