# Code Role Notes

## Minimal safe patch
1. Extend `ensureParentTeamAccess(userId, teamIds)` to accept `options = {}`.
2. Derive `strict` flag from options.
3. In catch block, rethrow when strict.
4. Update rideshare submit path to call `ensureParentTeamAccess(..., { strict: true })`.
5. Update unit test to lock in strict precondition behavior.

## Files touched
- `parent-dashboard.html`
- `tests/unit/parent-dashboard-rideshare-access-sync.test.js`
