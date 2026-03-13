Smallest viable change:
- Preserve existing add/update flow for games and practices.
- After persistence succeeds, run notification + scheduleNotifications(sent=true) in a separate guarded block.
- If that guarded block fails, log it and alert partial success instead of throwing the save path into the generic error handler.
- Add module-level RSVP request token; increment on each modal open and ignore responses/errors whose token is stale.
Controls: no schema changes, no backend changes, no broadened access. Blast radius stays in one page.
Rollback: revert the single page change.
