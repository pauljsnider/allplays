# QA Role Notes

## Validation Focus
- Calendar and parent dashboard still show my RSVP + summary text for tracked DB events.
- Events that already carry `rsvpSummary` are not rehydrated.
- Failures in one summary fetch do not block page rendering.

## Manual Checks
1. Load `calendar.html` for a team with many recurring events.
2. Load `parent-dashboard.html` for same data.
3. Confirm summary counts and button state render as before.

## Known Constraint
Repo has no automated test runner; verification is manual for these pages.
