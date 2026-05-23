# Code Plan

- Add `uploadedStatSheetFile` and `uploadedStatSheetUrl` module state.
- Set `uploadedStatSheetUrl` after loading `currentGame`.
- In Apply, derive `statSheetUrl` from cached/current URL and guard uploads by file identity.
- Update `currentGame` after successful commit with `applyPlan.gameUpdate`.
- Keep Apply visible after success for corrections.
- Add a smoke assertion that a second Apply commits but does not re-upload.
