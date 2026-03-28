# Requirements Role (fallback synthesis)

- Requested `allplays-requirements-expert` / `sessions_spawn` tooling is unavailable in this runtime; this file captures the equivalent requirements lane output.
- Objective: confirm PR #298 addresses the review findings without regressing parent rideshare behavior for recurring ICS practices.
- Current state at reviewed commit `4639c08761`: new occurrence-specific tracking ids were added, but `utils.js` cache tokens and legacy rideshare key compatibility were flagged.
- Current state at PR head `61a19fc580`: `edit-schedule.html` and `parent-dashboard.html` both bump `utils.js` to `?v=9`; parent rideshare flows preserve `calendarEventUid` and pass legacy fallback ids through refresh/create/manage paths.
- Decision: keep the shipped code path, then align stale validation to the new function signature and fallback behavior so evidence matches implementation.
- Risk surface: parent dashboard rideshare for synced recurring practices; blast radius is limited to parent schedule and ride-offer interactions.
- Success criteria: page modules load under mixed HTML/JS caching, legacy UID-keyed ride offers remain visible/manageable after deploy, and focused unit checks pass.
