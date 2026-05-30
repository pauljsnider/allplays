# QA Plan

- Add regression coverage where `canUpdateScore: true` and `isTeamStaff: false`; verify live score is visible and lineup publish is hidden.
- Update existing staff lineup publish tests to set `isTeamStaff: true` explicitly.
- Run the focused Vitest file, then the unit test suite if feasible.
