# QA

Primary regression to cover:
- Platform admin can open `edit-config.html#teamId=...` for a team they do not own and are not listed on.

Guardrails:
- Parent-linked users remain blocked from stats config management.
- Missing or invalid team lookup still redirects safely.

Validation plan:
- Run `npm test -- edit-config-access.test.js team-management-access-wiring.test.js team-access.test.js`.
- Manual spot-check: sign in as platform admin, open team page, click `Stats`, confirm page loads instead of redirecting.
