# Requirements

## Scope
Address Codex review 4159493382 for PR #576 by ensuring the create-team flow lands on a fully initialized edit-team page and by keeping regression coverage aligned with the Team ID UI that now renders on that page.

## Acceptance Criteria
- After creating a team, navigation lands on `edit-team.html?teamId=<id>` so the page boots with a fresh load and `currentTeamId` is available from URL state.
- Existing team edit behavior remains unchanged for owners and admins.
- The edit-team regression test harness includes the Team ID panel nodes required by the live page so tests exercise the current DOM contract instead of failing on missing elements.
- Unit tests covering edit-team access persistence pass.

## User Impact
- Coaches creating a new team land on the real edit page for that new team instead of a partially initialized state.
- Parents and team admins keep seeing the expected edit access behavior on reload.
- The Team ID panel remains present without breaking tests.

## Edge Cases
- Newly created team with no prior `teamId` in page state.
- Admin email normalization and permission checks after reload.
- Edit page initialization when the Team ID panel is rendered but no copy action is taken.

## Open Questions
- None for this review scope.

## Orchestration Note
- Required subagent spawn was attempted from the main run, but the local gateway timed out before child sessions became usable. This artifact records the enforced requirements view so traceability is preserved.
