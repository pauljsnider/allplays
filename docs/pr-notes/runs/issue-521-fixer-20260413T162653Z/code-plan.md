# Suspected root cause
The start-over branch in `js/live-tracker.js` reset game metadata and deleted `events` plus `aggregatedStats`, but it left `liveEvents` behind. Because resume logic can hydrate from `liveEvents`, stale opponent stats and other tracked data could survive a supposed reset.

# Smallest safe patch
1. Extend the reset branch to read and delete `liveEvents` in addition to `events` and `aggregatedStats`.
2. Update in-memory `currentGame` and tracker state so the reopened tracker immediately renders a clean reset state.
3. Add one integration-style Vitest harness test covering the full branch.

# Test placement
- New file: `tests/unit/live-tracker-start-over.test.js`
- Keep existing helper tests unchanged.

# Implementation cautions
- Preserve opponent linkage fields exactly.
- Do not alter resume-accept flow.
- Keep the patch local to the reset branch, no unrelated refactor.

# Files likely touched
- `js/live-tracker.js`
- `tests/unit/live-tracker-start-over.test.js`
