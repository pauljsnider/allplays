Implementation plan:
1. Add `data-rsvp-container` to the RSVP wrapper div in `calendar.html`.
2. Update `submitCalendarRsvpFromButton` to scope the child selector lookup with `closest('[data-rsvp-container]')`.
3. In `js/calendar-rsvp.js`, store `linkedPlayersByTeam?.get(teamId)` once in `players`.
4. Normalize that value into `playerArray` and derive `allowedPlayerIds` from `playerArray`.
5. Validate with a focused helper invocation and inspect the diff before committing.
