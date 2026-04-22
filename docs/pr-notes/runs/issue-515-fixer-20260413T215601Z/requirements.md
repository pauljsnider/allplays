# Requirements

## Acceptance Criteria
- Team admins can apply a reusable preset library from the stats config page, including a blank-slate option.
- Team admins can load a schema from another team they own, review it in the current form, adjust it, and save it as a new config.
- Team admins can edit an existing team config in place, including columns and advanced stat definition metadata.
- Team admins can reset the team stats setup back to an empty initial state, but only when no config is assigned to scheduled or shared games.
- Reset is schema-only. It must not delete tracked game events, aggregated stats, or live game data.

## User Workflow
1. Open team stats settings.
2. Choose a preset or load a schema from another owned team.
3. Review and adjust columns, formulas, top-stat flags, privacy, and grouping.
4. Save as a new config or update an existing config.
5. If needed later, reset the team back to initial schema setup after removing any game assignments.

## Edge Cases
- Import options should stay inside the user’s owned-team scope.
- Reset must hard-stop if any config is still referenced by scheduled or shared games.
- Blank-slate creation still needs explicit validation so empty configs are not saved accidentally.
- Editing should not silently detach live or scheduled games from their assigned config.

## Recommended Scope Cuts
- Do not add schema archival or cross-account sharing in this fix.
- Do not migrate historical tracked game data.
- Do not add a separate drag-and-drop reorder UI if ordered columns plus editable definitions cover the immediate gap.

## Manual Verification Notes
- Confirm preset apply populates the form correctly.
- Confirm import from another owned team loads the selected schema into the form.
- Confirm edit-in-place updates an existing config.
- Confirm reset clears configs only when none are assigned.
- Confirm reset does not touch existing game tracking data.
