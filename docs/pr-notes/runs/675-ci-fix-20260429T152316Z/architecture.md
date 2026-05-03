# Architecture Notes

## Acceptance Criteria
- Edit schedule calendar imports render after users select a schedule filter, even if the page initialization is still resolving team context.
- Practice-only filter state selected early is preserved and applied by the first real schedule load.
- No Firebase data model, calendar merge, or row rendering behavior changes.

## Decision
The failure is a client-side initialization race. Schedule filter controls are interactive before `init()` finishes setting `currentTeam`. If a filter event fires during that window, `loadSchedule()` can run without team context and fail before writing imported calendar rows into `#schedule-list`.

## Minimal Fix
Keep the filter state update, but only call `loadSchedule()` from filter/toggle handlers after `currentTeam` exists. The later `init()` load uses the selected filter and renders the correct imported rows.

## Risks And Rollback
- Risk is low: this only gates premature reloads before team context exists.
- Rollback is restoring the prior handler behavior in `edit-schedule.html`.
