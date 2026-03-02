# Requirements Role Notes

Objective: Resolve PR thread PRRT_kwDOQe-T585xFFv5 by preventing inactive-team historical/replay views from failing when team metadata is fetched.

Required behavior:
- Historical/replay flows must be able to load inactive teams.
- Active-only filtering should remain default for normal team-management flows.
- Change scope must be minimal and targeted to the review concern.

Acceptance evidence:
- History/replay page team fetches use `getTeam(..., { includeInactive: true })` where needed.
- No broad behavior change to all `getTeam` calls.
