# Architecture

Architecture Decisions
- Keep scorekeeping and lineup publishing permissions separate in the UI.
- Continue using `event.canUpdateScore` for score editing and cancellation controls.
- Gate the lineup publish panel with `event.isTeamStaff === true`, matching the server-side write authority for `gamePlan`.

Risks And Rollback
- Risk is limited to visibility of one Game hub panel.
- Rollback is a single conditional/test revert if product decides scorekeepers should receive explicit staff promotion messaging instead.
