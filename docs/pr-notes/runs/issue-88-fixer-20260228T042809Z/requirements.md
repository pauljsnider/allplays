# Requirements Role (manual fallback)

## Objective
Fix issue #88 so weekly recurrences honor `interval` in `expandRecurrence`.

## User-facing requirement
When a coach selects recurring weekly practices with `Every: 2 week(s)`, generated occurrences must appear every other week on selected weekdays.

## Acceptance criteria
- Weekly recurrence with `interval: 2` and `byDays: ['MO']` expands as `2026-03-02, 2026-03-16, 2026-03-30...`.
- Weekly recurrence with `interval: 1` behavior remains unchanged.
- Existing daily interval behavior remains unchanged.

## Risk and blast radius
- Risk surface: `js/utils.js` recurrence expansion used by schedule views.
- Blast radius: schedule occurrence generation/display and any flows consuming recurrence expansion.
