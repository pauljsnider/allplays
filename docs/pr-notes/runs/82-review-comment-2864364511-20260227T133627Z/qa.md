# QA Role Summary

## High-Risk Regression Areas
- Admin invite acceptance success path.
- Duplicate invite redemption rejection path.
- Parent invite path should remain unchanged.

## Manual Test Matrix
1. Single redemption: admin invite accepted, user redirected to dashboard, team admin list includes user email when profile has email.
2. Duplicate redemption: first succeeds, second gets `Code already used`, no coach grant for second user.
3. Parent invite unaffected: parent invite still links user and redirects to parent dashboard.

## Evidence Needed
- Transaction helper invoked by admin flow.
- No remaining direct `markAccessCodeAsUsed` call in admin invite acceptance path.
