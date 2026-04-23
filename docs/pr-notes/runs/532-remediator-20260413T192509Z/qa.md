# QA

## Highest-Risk Scenarios
- Two rostered players share the same display name.
- A player name changes after a substitution is saved, then the game is reopened.
- Legacy saved games only contain name-based substitution payloads.

## Manual Test Cases
1. Start with a planned lineup, apply a substitution, reload the page, and confirm the field diagram plus OUT/IN dropdowns show the substituted player on the field.
2. Apply a second substitution after reload and confirm it targets the substituted-in player's current position.
3. Use two players with the same name, substitute one for the other, reload, and confirm the correct player remains on the field.
4. Open a legacy record with name-only substitution data and confirm replay still works.

## Expected Outcomes
- Current on-field map is derived from stable player IDs when available.
- Dropdown eligibility matches the actual lineup after reload.
- Legacy substitution data remains readable.

## Regression Checks
- Run `test-game-day.html` and confirm Suite 5 passes.
- Spot-check that field rendering and bench chips still use the merged on-field map.
