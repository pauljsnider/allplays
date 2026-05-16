# Code plan

Implementation plan:
- Add `isSavingSummary` state inside `setupSummaryControls`.
- Add a small helper to sync Save Summary disabled state.
- Guard the save click handler against duplicate submissions.
- Set/reset the in-flight flag around `updateGame(...)` and preserve the disabled state while the editor is closed/reopened.
