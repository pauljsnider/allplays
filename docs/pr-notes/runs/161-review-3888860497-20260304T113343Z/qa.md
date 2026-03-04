# QA Role (allplays-qa-expert)

## Risk Matrix
- High: incorrect RSVP totals after roster edits in same session (core coach workflow correctness).
- Medium: unintended behavior change in non-override RSVP paths.
- Low: doc-only artifact additions.

## Automated Tests To Add/Update
- No targeted unit seam currently exposes `computeRsvpSummary` cache toggle without broad test harness changes in `js/db.js`.
- Run existing RSVP-focused unit tests as regression safety net:
  - `tests/unit/rsvp-summary.test.js`
  - `tests/unit/rsvp-hydration.test.js`
  - `tests/unit/rsvp-doc-ids.test.js`

## Manual Test Plan
1. Open schedule/game context as coach.
2. Submit override RSVP for player A; verify summary updates.
3. Edit roster in same session (add/remove player).
4. Submit another coach override.
5. Verify `rsvpSummary.total` and `notResponded` match current roster size.

## Negative Tests
- Force a permission-denied scenario and confirm error handling unchanged.
- Use recurring-occurrence game ID and confirm not-found suppression still prevents override crash during summary writeback.

## Release Gates
- Targeted RSVP unit tests pass.
- No unrelated file modifications.
- Patch limited to RSVP summary cache freshness behavior.

## Post-Deploy Checks
- Spot-check one real team where coach overrides follow same-session roster changes.
- Monitor support/issue channel for RSVP count mismatch reports for 24 hours after deploy.
