# QA Role

## QA Plan
- Verify the smoke stub exports match `edit-team.html` imports, especially `escapeHtml`.
- Run unit tests to ensure roster rollover and admin invite unit coverage still pass.
- Let CI run full preview smoke because the local host cannot install Playwright Chromium due disk exhaustion.

## Impacted Workflows
- Existing-user admin invite fallback from `edit-team.html`.
- Admin invite redemption from `accept-invite.html`.
- No production change to parent invites or roster rollover.
