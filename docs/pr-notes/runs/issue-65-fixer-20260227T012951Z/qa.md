# QA Role Synthesis

## Test Strategy
- Add unit tests for team visibility helpers and soft-delete payload generation semantics.
- Add at least one UI-surface-oriented test by validating search/discovery filtering helper behavior.
- Run targeted Vitest suites covering new behavior and nearby regressions.

## Critical Regressions to Guard
- `deleteTeam` must not delete subcollections.
- Inactive teams must be excluded from browse/search/opponent linking via default list helpers.
- Parent future workflow helper output should skip inactive teams.
- Replay list should still include inactive-team completed games.

## Manual Spot Checks (post-unit)
- Dashboard team cards no longer show deactivated teams.
- Teams browse page excludes deactivated teams.
