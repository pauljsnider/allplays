# Code Role Plan

## Minimal Safe Patch
1. Update `js/team-access.js`:
   - remove coach-derived full-access branch
   - keep owner/admin email/platform-admin checks
2. Update `tests/unit/team-access.test.js`:
   - replace coach allow expectations with coach deny expectations
3. Run targeted unit tests for team access and page wiring.
4. Commit and push to `paulbot/fix/issue-115-202603020226`.
