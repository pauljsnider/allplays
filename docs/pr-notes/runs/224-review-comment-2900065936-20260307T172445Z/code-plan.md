# Code Role Summary

Thinking level: medium

## Patch Plan
1. Leave `js/db.js` helper behavior intact and add direct unit coverage for its read-failure contract.
2. Replace `Promise.all` with `Promise.allSettled` in the incentives panel loader.
3. Drop failed or missing-game cache entries instead of preserving stale earnings.
4. Add a parent-visible warning banner that totals exclude failed game reads.
5. Extend incentives rendering tests for the warning state.

## Conflict Resolution
- The review comment points at the helper, but the helper is already guarded on this branch.
- The actual remaining defect is broader: the caller still fails closed for the entire panel.
- Fixing the caller plus locking the helper behavior in tests resolves the user-facing risk with the smallest safe patch.
