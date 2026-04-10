Coverage strategy:
- Add a Playwright smoke spec under `tests/smoke/` because that is the repo’s browser-level automated lane.

Scenario 1:
- Team page with one DB game and one imported practice on the same future date.
- Switch to calendar.
- Select `Upcoming Practices`.
- Verify only the practice appears in the day cell and the day modal.

Scenario 2:
- Team page with:
  - one tracked calendar UID that should be suppressed
  - one cancelled calendar event
  - one completed DB game
  - one normal upcoming calendar event
- Verify:
  - `Recent Results` shows only the completed DB game
  - `All Upcoming` excludes cancelled and tracked-duplicate items in list and calendar mode
  - `Past Events` includes the completed DB game and cancelled event in list and calendar mode

Validation:
- Run the new smoke spec against a local static server.
- Run the focused unit test command for confidence that the targeted change does not break the existing vitest lane.
