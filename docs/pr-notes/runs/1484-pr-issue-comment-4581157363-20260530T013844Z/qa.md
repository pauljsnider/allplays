# QA Plan

## Risk Guardrails
- Unauthorized teams must block all writes before `firestore.batch()` is created.
- The guard must check every unique home and away team.
- Global admin behavior must continue to pass through `hasTeamAdminAccess`.
- Existing invalid draft, missing team, same-team, and organization-boundary errors must remain intact.

## Automated Validation
Run:
```bash
npx vitest run tests/unit/organization-schedule.test.js --reporter=verbose
node --check functions/index.js
git diff --check
```

## Manual Regression Targets
1. Authorized org admin who is also team admin for all participating teams publishes successfully.
2. Org admin missing admin access on any home/away team gets `permission-denied` and zero created games.
3. Global admin can still publish valid drafts.
4. Publish with no generated draft slots remains blocked in the UI before callable invocation.
