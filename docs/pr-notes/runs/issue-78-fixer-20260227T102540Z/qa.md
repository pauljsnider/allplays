# QA role synthesis

## Regression matrix
- Allowed: owner, admin email, platform admin, delegated coach.
- Denied: unrelated authenticated user.

## Automated coverage plan
- Add unit tests for access helper used by edit pages:
  - coachOf includes team id -> allowed
  - non-coach unrelated user -> denied

## Manual smoke checks
1. Sign in as delegated coach and open `team.html#teamId=<id>`.
2. Click `Edit` and `Roster` from banner.
3. Verify no access-denied alert and no redirect to dashboard.

## Risks to monitor
- Email case-insensitive admin behavior must remain unchanged.
