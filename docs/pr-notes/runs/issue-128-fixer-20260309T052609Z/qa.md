Test focus:
- Prove delegated coaches receive full team access through the shared helper.
- Guard the missing-team-id edge case so access is not granted without a concrete team id.
- Reconfirm parent-only and unrelated-user behavior.

Regression risks:
- Over-broad coach access if `coachOf` is honored without a valid team id.
- Silent UI/access divergence if only helper tests change and page wiring drifts later.

Planned validation:
- Update `tests/unit/team-access.test.js` to fail on current behavior and pass after the fix.
- Run the focused Vitest command for `team-access.test.js`.
- Run `team-management-access-wiring.test.js` to confirm edit pages still rely on the shared helper.

Manual reasoning:
- `edit-team.html` and `edit-roster.html` already route through `hasFullTeamAccess(...)`, so a passing helper regression is sufficient for this targeted fix.
