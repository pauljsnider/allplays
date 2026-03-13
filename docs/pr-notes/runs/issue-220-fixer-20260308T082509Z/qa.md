# QA Role (fallback synthesis)

## Test Strategy
1. Add a unit test proving a shared game projects into a team schedule with opponent metadata and synthetic shared ID.
2. Add a unit test proving placeholder entrants render as `TBD` and do not require duplicated team docs.
3. Add a unit test proving merged schedules keep local team games and projected shared games together without duplicates.

## Regression Guardrails
- Keep tests pure and independent of Firebase runtime.
- Preserve existing team-owned game IDs and fields.

## Manual Smoke
- Open a team page backed by a shared game and verify the matchup renders once and loads the same underlying record for both teams.
