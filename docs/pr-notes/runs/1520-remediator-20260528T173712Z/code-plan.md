# Code Plan

Implementation Plan
- In `ScheduleEventDetail.tsx`, introduce a staff-only `canPublishLineup` condition using `event.isTeamStaff` and render `GameHubLineupPublishPanel` only with that flag.
- In `tests/unit/app-schedule-more-tab-integration.test.jsx`, update lineup publish setup data for staff tests and add the non-staff scorekeeper regression.
- Validate with focused unit tests and available app validation commands.
