# QA Role

## Automated Coverage
- Assert scorer resolution appears before score mutation in `recordGoalSportGoal`.
- Assert invalid non-empty scorer shows a prompt/focus path and returns before score mutation.
- Assert scorer stats are rolled back in the goal undo branch, including in-memory stat update, DOM update, persistence sync, and reversed-stat broadcast.
- Preserve helper coverage for exact name and jersey-number scorer resolution.

## Manual Smoke Plan
1. Start a goal-sport live tracker game.
2. Enter an unknown scorer and record a goal. Expected: prompt shown, score/log/live feed/stat unchanged.
3. Leave scorer blank and record a goal. Expected: team score increments, no player stat mutation.
4. Enter valid home scorer by name or `#number`, record, then undo. Expected: score and player goals increment then decrement.
5. Repeat for away/opponent scorer. Expected: away score and opponent goals increment then decrement.

## Regression Guardrails
- Score and stat values must not go negative on undo.
- Missing DOM stat cell must not prevent in-memory and persistence sync rollback.
