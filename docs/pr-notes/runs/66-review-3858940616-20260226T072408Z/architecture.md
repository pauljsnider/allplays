# Architecture Role Synthesis (fallback, no sessions_spawn/allplays skill available)

## Current state
`createDateFromTimeZone` uses 3 fixed-point iterations. For DST-gap local wall-clock times, two candidate instants can oscillate, making outcome iteration-parity dependent.

## Proposed state
Detect non-converging oscillation and apply deterministic gap policy: choose the later instant among oscillation endpoints.

## Why this works
For spring-forward gaps, the later instant corresponds to applying pre-gap offset to the requested wall-clock and lands on the first representable local time after the jump (for `02:30` gap, local `03:30`).

## Risk and blast radius
- Blast radius: `parseICS` timezone helper only.
- Risk: edge behavior around DST overlaps remains unchanged because fixed-point convergence path is preserved.
- Control: add explicit DST-gap regression test.
