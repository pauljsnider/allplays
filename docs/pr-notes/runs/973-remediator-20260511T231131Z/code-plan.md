# Code Plan

1. In `js/db.js`, replace user-data spreads with local `allowedFields` objects for venue availability, organization blackouts, and venue blackouts.
2. In `organization-schedule.html`, add a helper that confirms `anchorTeam`, full access, and enough organization teams before venue-control writes.
3. Extend `disableScheduleInputs()` to disable venue-control forms and refresh control when init is blocked.
4. Run a minimal syntax check with `node --check` for changed JavaScript-bearing files, then commit.
