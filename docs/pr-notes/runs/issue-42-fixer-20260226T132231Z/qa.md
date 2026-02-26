# QA Role Notes

## Regression Risks
- Missing team doc update for admin email causes false-positive success UX.
- Overwriting existing `coachOf` or `roles` arrays could regress existing user metadata.
- Double acceptance could create duplicates.

## Test Strategy
- Unit-test shared admin invite helper:
1. Fails if team missing.
2. Persists normalized team admin email.
3. Merges (does not overwrite) existing `coachOf` and `roles`.
4. Marks code used when `codeId` is present.
5. Skips mark-used when `codeId` absent.

## Manual Validation Focus
- Invite accepted via `accept-invite.html?code=...` grants edit-team access.
- Invite accepted via signup/login code path also grants access.
- Existing team owner/global admin behavior unchanged.
