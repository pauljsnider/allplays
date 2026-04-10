Objective: cover imported ICS rows in `edit-schedule.html` from page load through visible coach actions.

Current state:
- Unit tests cover calendar import helpers and string wiring.
- No browser test exercises `loadSchedule()` with `team.calendarUrls`.

Proposed state:
- Browser coverage loads `edit-schedule.html`, mocks ICS payloads, and verifies imported practice/game rows as a coach sees them.

Risk surface:
- Silent regression can hide imported events, render duplicate rows, or expose the wrong CTA.
- Imported practice planning loses context if the calendar merge drops required fields.

Assumptions:
- Existing coach UX is acceptable: imported practices are visible when the practice filter is enabled or the practice-only view is selected.
- Calendar practice planning should preserve UID, date, duration, title, and location in the generated `drills.html` link.

Recommendation:
- Add one focused Playwright spec with two scenarios matching the issue.
- Keep the code fix limited to import merge behavior needed by the page test.

Success:
- Imported practice row renders with calendar/practice badges and `Plan Practice` link containing preserved calendar context.
- Tracked and conflicting imports stay hidden.
- Cancelled imports render a cancelled row with no action button.
