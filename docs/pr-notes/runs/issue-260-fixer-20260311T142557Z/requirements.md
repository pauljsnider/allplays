Objective: ensure all legacy game-summary email flows honor the team notification inbox before falling back to the signed-in coach email.

Current state:
- `track.html` and `js/track-basketball.js` address summary mailto links to `currentUser.email`.
- Team settings already expose `notificationEmail`, so the workflow violates a visible user control.

Proposed state:
- All summary email flows use the same recipient preference as `js/live-tracker.js`.
- Behavior is `currentTeam.notificationEmail` first, then `currentUser.email`, then empty string.

Risk surface and blast radius:
- Affects only client-side summary email recipient selection on legacy trackers.
- No schema, auth, or persistence changes.

Assumptions:
- `currentTeam` is loaded before summary actions are available.
- Reusing the existing helper keeps behavior consistent across trackers.

Recommendation:
- Reuse `resolveSummaryRecipient()` rather than duplicating fallback logic.
- Add regression tests that verify helper usage is wired into both legacy trackers.

Success measure:
- Focused tests fail before the patch and pass after it.
- Manual behavior aligns with the configured team notification inbox on both legacy tracker paths.
