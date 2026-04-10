Objective: protect the `team.html` schedule workflow where a coach or parent switches from list view to calendar view, filters the schedule, and opens a clicked-day modal.

Current state:
- `team.html` merges Firestore games with imported calendar events.
- It renders list and calendar views through separate paths.
- The clicked-day modal re-filters events again.

Proposed state:
- Add smoke coverage that exercises the Team page directly.
- Ensure the `Upcoming Practices` filter works even when `Show Practices` remains off.
- Confirm duplicate tracked calendar events and cancelled calendar events stay out of the wrong filters in both list and calendar modes.

Risk surface:
- User-facing schedule visibility on a public team page.
- Duplicate suppression for tracked ICS events.
- Calendar/list divergence and day-modal divergence.

Assumptions:
- Existing smoke tests are the repo’s Playwright coverage lane.
- The intended behavior matches `edit-schedule.html`, which already forces practice visibility for the dedicated practice filter.

Recommendation:
- Add one focused Team page smoke spec with two scenarios matching the issue.
- Apply the smallest behavioral fix in `team.html` only if the new smoke coverage exposes a defect.

Success criteria:
- `Upcoming Practices` shows practice-only results in list, calendar, and day-modal contexts without requiring the checkbox.
- `Recent Results`, `All Upcoming`, and `Past Events` keep completed, future, cancelled, and duplicate-tracked items in the correct buckets.
