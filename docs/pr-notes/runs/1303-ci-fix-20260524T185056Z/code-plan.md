# Code plan

Subagents were unavailable in this environment, so this role analysis was completed inline.

Implementation: update only `tests/smoke/app-home-player.spec.js` so `appUrl` uses `process.env.SMOKE_APP_BASE_URL || baseURL`, matching other app smoke specs. No product source change is needed because the CI failure is test URL drift in static-hosting preview.

Risk: low. The helper still falls back to the prior `baseURL` behavior when `SMOKE_APP_BASE_URL` is not set.
