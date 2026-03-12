Implementation plan:
1. Tighten the existing `edit-schedule` cancel-flow regression test so it requires an awaited schedule reload.
2. Change the successful cancellation branch in `edit-schedule.html` from `loadSchedule();` to `await loadSchedule();`.
3. Run focused Vitest coverage for the cancel-game helper and related edit-schedule cancellation behavior.

Why this is enough:
- The repo already contains the larger fix that separates cancellation success from chat failure.
- The remaining user-visible defect is stale UI timing during the partial-success branch.

Out of scope:
- Backend transaction changes.
- Retry logic for failed team-chat notifications.
