# Requirements Role Notes

- Objective: Resolve PR review thread `PRRT_kwDOQe-T585yWZOG` in `edit-team.html`.
- Reported issue: During edit-page load, `currentTeamId` is unset until `getTeam(teamId)` resolves.
- Risk: User can submit while fetch is pending and trigger create flow (`createTeam`) from an edit URL.
- Required behavior: Enter edit mode immediately when `teamId` exists so submit path cannot fall back to create mode during async load.
- Scope guard: Minimal targeted fix only; no unrelated refactor.
