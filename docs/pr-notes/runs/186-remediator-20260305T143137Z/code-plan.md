# Code Role Notes

- Implement one-line mode-order fix in `init()`:
1. In `if (teamId)` branch, assign `currentTeamId = teamId` before `await getTeam(teamId)`.
2. Retain existing `currentTeamId = null` reset when team is missing.
- Do not alter submit handler logic or unrelated UI.
