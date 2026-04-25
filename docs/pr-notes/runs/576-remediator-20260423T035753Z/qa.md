# QA role notes

## Risk assessment
- Primary risk is duplicate team creation if users click Save again after initial create.
- Secondary risk is regression in edit-team deep linking if the redirect format changes.

## Manual test plan
1. Open `edit-team.html` in create mode.
2. Create a new team with required fields.
3. Verify the resulting URL includes `?teamId=<new id>` and the page is in edit mode.
4. Verify the Team ID panel is visible and management links include the new team ID.
5. Click Save again after changing a field and confirm the existing team updates instead of creating a second team.
6. Open an existing `edit-team.html#teamId=<id>` legacy link and confirm the team still loads.

## Regression checks
- Existing team edit flow still loads banner, photo, admin list, and management links.
- `created=1` remains present after post-create redirect when requested.

## Evidence that proves the fix
- URL changes from fragment-only to query-string navigation after create.
- On reload, `initialTeamId` is populated and `updateTeamIdPanel()` runs with the created team ID.
- No duplicate team is created on a subsequent save.
