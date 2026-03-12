Test strategy:
- Add a focused unit test for legacy tracker email recipient behavior.
- Verify both `track.html` and `js/track-basketball.js` reference `resolveSummaryRecipient()` and pass `currentTeam?.notificationEmail`.

Failure proof:
- The new test should fail against the current source because neither legacy tracker references the shared helper or team notification email.

Regression guardrails:
- Preserve fallback to `currentUser.email` when the team notification email is blank.
- Confirm the existing live-tracker email tests still pass.

Manual spot checks recommended:
1. Set a team notification email in `edit-team.html`.
2. Finish one game through `track.html` and one through `track-basketball.html` with send-email enabled.
3. Confirm the opened mail client addresses the team inbox.
