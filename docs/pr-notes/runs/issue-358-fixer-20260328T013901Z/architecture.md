Chosen thinking level: medium
Reason: narrow UI workflow with existing helper split, but needs validation across handler behavior and rendered output.

Architecture synthesis:
- Preserve the existing `cancelScheduledGame` helper boundary.
- Update `edit-schedule.html` to derive `scheduleNotifications.sent` from actual chat success.
- Verify rendering by executing the existing `renderDbGame` function body in a unit harness.

Tradeoffs:
- This keeps changes local to the page instead of broader refactoring into new modules.
- Unit coverage is faster and more deterministic than introducing a browser harness for a static-page repo.

Rollback:
- Revert the single handler metadata change and associated tests.
