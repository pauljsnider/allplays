Test strategy:
- Add a unit wiring test for `player.html` that asserts the page uses `hasFullTeamAccess` and no longer derives edit permission from `coachOf`.
- Run the new focused test first to demonstrate the existing bug.
- Run the full unit suite after the fix to check for regressions in adjacent access-control helpers.

Primary regression to guard:
- `coachOf`-only users see Edit Profile again.

Secondary regression to watch:
- Linked parents still retain edit access.
- Team owner/admin/platform admin still retain edit access through the shared helper.
