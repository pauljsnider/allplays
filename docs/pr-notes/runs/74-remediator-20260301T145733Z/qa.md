# QA Role Notes

Validation focus:
- Load a completed game for an inactive team in live tracker/report path.
- Confirm page no longer fails due to null team metadata.
- Confirm active-team flow still works unchanged.

Manual checks:
1. Open a game URL for an inactive team and verify header/team UI renders.
2. If linked opponent team is inactive, verify linked-team metadata still resolves.
3. Spot-check an active team game to ensure no regression.
