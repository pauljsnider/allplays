# QA

## Risk Assessment
- Primary risk: stored XSS through user-controlled team names on the organization schedule page.
- Secondary risk: regression in default team selection or post-publish navigation links.

## Regression Targets
- `renderTeamOptions` populates both selects with the same team ordering and preferred selection behavior.
- `renderSuccess` still shows both schedule links after publishing.
- Existing helper behavior in `js/organization-schedule.js` remains intact.

## Test Plan
- Run the organization schedule unit test file.
- Add source-level regression coverage that fails if the page goes back to string-built select options or success HTML.
- Spot-check the generated success links and preferred team selection logic in the diff.

## Acceptance Evidence
- Unit tests pass for `tests/unit/organization-schedule.test.js`.
- Source no longer uses `innerHTML` for team option rendering or success banner rendering in `organization-schedule.html`.
