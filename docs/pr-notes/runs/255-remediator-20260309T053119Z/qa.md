Validation scope:
- Focused regression on `tests/unit/team-access.test.js`.

Checks:
1. Owner retains full access.
2. Team admin email retains full access.
3. Platform admin retains full access.
4. `coachOf` alone no longer grants full access.
5. `getTeamAccessInfo` no longer reports `full` for `coachOf`-only users.

Manual spot-check recommendation:
- Attempt `edit-team.html?teamId=<id>` and `edit-roster.html?teamId=<id>` as a `coachOf`-only user and confirm redirect/denial instead of a later save failure.
