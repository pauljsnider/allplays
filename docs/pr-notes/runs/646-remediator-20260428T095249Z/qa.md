# QA Plan

## Automated
- Run `npm test -- tests/unit/roster-rollover-preview.test.js` for the affected preview wiring and helper tests.
- Run broader unit coverage if time allows.

## Manual
1. Sign in as a user whose auth email is missing but profile email matches a team `adminEmails` entry. Enable roster rollover and verify the team appears.
2. Enable roster rollover, rapidly switch source team A to B, and verify only B's roster preview remains visible after both fetches complete.
3. Start a preview fetch, disable rollover or clear the source team, and verify the stale result does not reappear.
