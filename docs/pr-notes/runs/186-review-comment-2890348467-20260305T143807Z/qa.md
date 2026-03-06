# QA Role Notes

## Regression Focus
- Edit flow with slow team fetch/auth callback.
- Create flow with no teamId.
- Unauthorized/not-found edit redirects.

## Manual Checks
- `edit-team.html?teamId=<valid>`: save button starts disabled, then enables; submit updates existing team.
- Simulated early submit during loading is blocked with loading message.
- `edit-team.html` (no teamId): save button enables after init and creates new team.

## Risks Remaining
- No automated browser test harness exists in repo; relies on manual verification.
