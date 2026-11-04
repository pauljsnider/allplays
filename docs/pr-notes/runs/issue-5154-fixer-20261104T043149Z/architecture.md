# Architecture Analysis — Issue #5154

## Root cause

`setPeriod()` assigns `state.period`, but gates all change-specific side effects on `state.running`. A paused transition skips `syncClockToGameDoc()`, the `period_change` event, and its log entry. Although `renderHeader()` indirectly saves local state, resume logic later prefers stale live-event/game-document clock state and restores the previous period.

## Minimal design

Keep `setPeriod()` synchronous and preserve existing helper contracts:

1. Capture the previous period, assign the new value, and update button styling.
2. When the value actually changed, add one log entry, persist local state explicitly, synchronize the game-document clock, and broadcast one `period_change` event when `liveState.isLive`.
3. Render the header as today.

The game-document update fixes fallback restoration. The live event informs viewers and supplies a current event-based resume source. Explicit local persistence makes durability visible at the mutation boundary.

Existing synchronization helpers own their error handling, and the live-event helper queues failed writes. Making `setPeriod()` async would not add useful guarantees because its click handler and comparable tracker mutations use fire-and-forget synchronization.

All change-only effects must remain inside `previousPeriod !== p`: initialization calls `setPeriod(state.period)` and must not log, write, or broadcast. Replacing the existing branch avoids duplicate effects while running.

## Prevention / learning

Model period, clock, and score changes as replicated state transitions. A mutation is complete only when all active representations receive the same value.

## Recurrence risk

**Medium** — the targeted fix closes this path, but rapid game-document writes remain best-effort and are not serialized.
