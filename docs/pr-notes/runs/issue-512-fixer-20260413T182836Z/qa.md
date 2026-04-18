# Issue #512 QA

## QA Plan
- Add focused unit coverage for `teams.html` click handling.
- Manually verify that card clicks still navigate and location link clicks open Maps without moving the current tab.

## Test Cases
1. Clicking a non-link area of a team card navigates to `team.html#teamId=<id>`.
2. Clicking the Google Maps location link does not navigate the current tab.
3. Cards without a location link retain existing card navigation behavior.
4. Clicking near the location row but not on the anchor still navigates.

## Regression Risks
- Over-broad event suppression could disable intended card navigation.
- Under-broad suppression could allow nested interactive elements to bubble again.

## Manual Verification
1. Open `teams.html`.
2. Click a team card body and confirm navigation to the team page.
3. Return to `teams.html`.
4. Click the location link and confirm Google Maps opens in a new tab while the current tab stays on `teams.html`.
5. Repeat with keyboard activation on the focused location link.

## Recommendation
Back the fix with a narrow Vitest unit test and targeted manual verification.