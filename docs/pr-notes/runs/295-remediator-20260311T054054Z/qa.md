Test target: `tests/unit/calendar-rsvp-scope.test.js`

Scenarios covered:
- Scoped event childIds stay narrowed to the selected event.
- Explicit childIds are filtered to the event scope.
- Legacy calendar fallback returns linked team players when event child metadata is absent.
- Coach/no-scope submissions return an empty player list instead of throwing.

Manual spot-check guidance:
- Open `calendar.html` as a coach-linked account on an event with no `childId` metadata.
- Click each RSVP button and confirm the action submits without the child-selection alert.

Evidence to collect if this regresses again:
- Browser alert text from `submitCalendarRsvp`.
- Event payload showing missing `childId` and `childIds`.
- `playerIdsByTeam` contents for the current user/team.
