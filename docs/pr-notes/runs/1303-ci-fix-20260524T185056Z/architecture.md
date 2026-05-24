# Architecture notes

Subagents were unavailable in this environment (sessions_spawn agent allowlist: none), so this role analysis was completed inline.

Root cause: `tests/smoke/app-home-player.spec.js` built app URLs from `baseURL` only. In the static-hosting preview job, app shell tests need to honor `SMOKE_APP_BASE_URL` so the hash route opens the Vite app host instead of the repository/static site root. Neighboring app smoke specs already use this pattern.

Decision: align the Home smoke helper with the existing app smoke URL contract rather than changing product code. This keeps the blast radius limited to the failing smoke spec and preserves the app/runtime architecture.
