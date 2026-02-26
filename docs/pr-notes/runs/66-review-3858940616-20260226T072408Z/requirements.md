# Requirements Role Synthesis (fallback, no sessions_spawn/allplays skill available)

## Objective
Resolve PR #66 review feedback so TZID parsing handles DST-gap local times deterministically.

## User value
- Coaches/parents importing calendars get stable event times near DST transitions.
- No parity-dependent one-hour drift on repeated imports.

## Acceptance criteria
- `DTSTART;TZID=Australia/Sydney:20261004T023000` resolves deterministically to an instant formatting as `03:30` in `Australia/Sydney`.
- Existing behaviors remain intact: `...Z` UTC timestamps and floating non-TZID timestamps.
- Blast radius stays isolated to ICS parsing helpers and related unit tests.
