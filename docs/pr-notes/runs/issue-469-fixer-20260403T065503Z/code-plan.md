Thinking level: medium.

Plan:
1. Add a `parent-dashboard.html` module test harness that exposes the calendar modal helpers without running full page init.
2. Seed two child rows for one tracked game, open the day modal, submit grouped RSVP, and assert the stale-modal failure.
3. Add the smallest production change that refreshes the active modal after RSVP render.
4. Re-run focused Vitest coverage and commit the targeted patch.
