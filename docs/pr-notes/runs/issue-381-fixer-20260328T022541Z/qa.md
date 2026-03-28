Test strategy:
- Unit: keep coverage on `getEditConfigAccessDecision()` and page wiring to the shared helper.
- Smoke: add a platform-admin workflow spec that opens `edit-config.html#teamId=team-a`, confirms the stats page renders, creates a config, deletes it, and stays on-page.

Primary regression to catch:
- Any future narrowing of the page access gate that excludes `user.isAdmin`.
- Redirects to `dashboard.html` after navigating from the schedule workflow.

Validation plan:
- Run targeted Vitest coverage for `edit-config` access and wiring tests.
- Run targeted Playwright smoke coverage for the new platform-admin scenario against a local static server.
