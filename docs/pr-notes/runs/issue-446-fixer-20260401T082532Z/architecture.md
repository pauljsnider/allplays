Current state:
- `team.html` uses `getAllEvents()` to merge DB games and imported calendar events.
- `getFilteredScheduleEvents()` applies the active filter and the practice checkbox.
- `renderScheduleCalendar()` builds calendar cells from filtered events.
- `openScheduleDayModal()` reuses `getFilteredScheduleEvents()` and then narrows to the selected day.

Observed defect:
- Practice events are removed before the `upcoming-practices` branch runs because `showPractices` defaults to `false`.
- That causes the dedicated practice filter and the day modal to miss valid practice events.

Reference behavior:
- `edit-schedule.html` already uses `forcePracticeVisibility = scheduleViewFilter === 'upcoming-practices'`.

Target change:
- Mirror the `edit-schedule.html` guard in `team.html`.
- Keep all other filtering, duplicate suppression, and cancellation rules unchanged.

Blast radius:
- Limited to Team page schedule filtering.
- No Firestore schema changes, no backend changes, no routing changes.
