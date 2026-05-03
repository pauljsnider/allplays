# QA Notes

## Targeted validation
- Run the focused unit/static tests for roster rollover and edit-team admin persistence.
- Verify `edit-team.html` includes `getUserProfile(user.uid)` and calls `getUserTeamsWithAccess(currentUser.uid, accessEmail)` where `accessEmail` falls back to profile email.
- Verify the source-team change handler captures a request id and checks both request id and current select value before rendering success or error UI.

## Manual checks for PR description
- Profile-email-only admin creates a team, enables roster rollover, and sees eligible prior teams.
- Auth-email user still sees eligible teams.
- Rapid Team A then Team B selection under slow network leaves the preview on Team B only.
- Clearing the selection while a fetch is in flight keeps the preview hidden.
- Saving remains preview-only and does not copy roster, family, staff, admin, or fan records.
