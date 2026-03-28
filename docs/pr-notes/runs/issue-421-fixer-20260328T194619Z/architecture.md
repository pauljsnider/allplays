# Architecture synthesis

- Root cause: persistence for opponent stats is edge-triggered through `scheduleOpponentStatsSync()`. Delete bypasses that edge, so Firestore keeps stale opponent entries.
- Control comparison:
  - Current: UI state changes locally, persisted state remains stale, resume restores stale opponent cards.
  - Proposed: UI state change is immediately queued for persistence, keeping resume hydration and stored state equivalent.
- Smallest viable change: call `scheduleOpponentStatsSync()` and `scheduleLiveHasData()` inside the `[data-opp-del]` click handler after filtering `state.opp`.
- Risk surface:
  - Low code risk because the same scheduling functions are already used for adjacent opponent edit/stat flows.
  - No schema change, no migration, no new persistence path.
- Rollback: revert the handler change if unexpected writes occur.
