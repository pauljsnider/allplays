# Code Plan

- Update `js/db.js` with `getMyConfirmedRsvp(teamId, gameId, userId)`.
- The helper queries `/rsvps` by `userId`, accepts confirmed response values, and falls back to the legacy direct doc.
- Update `game-day.html` import and confirmed-member gate to call the new helper.
- Keep the change scoped to PR review feedback.
