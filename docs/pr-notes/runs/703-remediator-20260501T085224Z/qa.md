# QA Notes

## Validation Plan

- Confirm team admin can update a fee recipient for their own existing team.
- Confirm team admin cannot update another team's fee recipient by changing the payload `teamId`.
- Confirm team admin cannot move their own fee recipient to another team.
- Confirm date-only due dates render as the same calendar date in `America/Chicago` and sort correctly.
- Confirm `parent-dashboard.html` imports a newer `db.js` cache token than the stale reviewed version.

## Release Gates

- Unit tests pass for affected frontend helpers.
- Firestore rules syntax/inspection confirms only collection-group `feeRecipients` write behavior changed.
