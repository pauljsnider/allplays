# Architecture Role Notes

- Current state: `init()` checks URL param, awaits `getTeam(teamId)`, then sets `currentTeamId = teamId`.
- Proposed state: Set `currentTeamId = teamId` immediately on entering the `teamId` branch, before awaiting data fetch.
- Blast radius: Single-page local state transition in `edit-team.html`; affects only submit-mode selection and admin invite mode gating.
- Control equivalence: Better than current behavior by preventing accidental create-path execution from edit URLs during load latency.
