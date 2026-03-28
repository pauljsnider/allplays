Validation target: `tests/unit/parent-dashboard-rsvp-controls.test.js`.

Checks:
- grouped-row RSVP still calls `submitRsvp` with the clicked child set and updates only matching local rows
- per-child card RSVP still calls `submitRsvpForPlayer` and leaves sibling state untouched
- controller reads the current schedule array after reassignment through `getAllScheduleEvents`
- `parent-dashboard.html` exports `window.submitGameRsvpFromButton` after controller destructuring

Result expected: focused Vitest file passes on PR head `eee4b13` plus this test-only follow-up commit.
