QA note

Primary regression to check:
- Successful coach RSVP update still refreshes the panel and shows Saved.
- Failed RSVP reload leaves the Failed to load RSVPs message visible and shows Save failed instead of Saved.

Validation plan:
- Module import/syntax check for js/game-day-rsvp-controls.js.
- Manual follow-up in game-day.html flow if needed because repo has no automated tests.
