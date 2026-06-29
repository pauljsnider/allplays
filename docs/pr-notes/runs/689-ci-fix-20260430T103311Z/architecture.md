# Architecture Notes

- Acceptance criteria: team schedule smoke tests must run against fully mocked team page dependencies and render the team header/schedule without live Firebase reads.
- Root cause: `team.html` imports `./js/db.js?v=76`, but the smoke harness still intercepted only `**/js/db.js?v=76`. The mock did not apply, so the page attempted to use the real DB module during static smoke and left skeleton content in place.
- Decision: keep production cache busting intact and make the test mock resilient to cache-bust version changes by matching `**/js/db.js?v=*`.
- Risk/rollback: test-only route change. Roll back by restoring the exact query match if needed.
