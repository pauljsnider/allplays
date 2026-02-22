# Architecture Role Notes (PR #33 Clock Sync)

## Objective
Validate architecture impact of periodic live heartbeat sync and silent viewer reconciliation.

## Current Architecture
- Tracker emits live events through `broadcastEvent(baseLiveEvent(...))`.
- Viewer ingests live events and appends non-system events to play feed.

## Decision
Keep event-driven sync approach with `clock_sync` as a system-only event.

## Controls and Blast Radius
- Current state blast radius: normal play events can drift when viewer joins late.
- New state blast radius: bounded heartbeat every 5s; viewer UI state can self-heal without chat/feed spam.
- Control equivalence: no expansion of access scope; same Firebase paths and auth controls.

## Tradeoffs
1. Keep heartbeat (selected): predictable reconciliation with low event overhead.
2. Increase heartbeat frequency: tighter sync but higher event volume.
3. Snapshot-on-join only: lower volume but stale state until reconnect/refresh.

## Rollback Plan
- Revert commits `bb4c0a3` and/or `0a69b6f` if live event volume or client behavior regresses.
