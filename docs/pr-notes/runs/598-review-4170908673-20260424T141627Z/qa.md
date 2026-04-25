# QA

## Risk Assessment
- Primary risk: preview pages importing `js/db.js` fail to boot if the missing module remains.
- Secondary risk: removing the stray helpers could affect hidden consumers, but repo search found no references outside `js/db.js`.

## Targeted Regression Set
1. Repo-wide search for `organization-shared-schedule` references.
2. Full unit test suite.
3. Targeted diff inspection to confirm tournament advancement code remains unchanged except for the stray import/helper removal.

## Commands
- `grep -RIn "organization-shared-schedule" . || true`
- `npm ci`
- `npm test`

## Release Recommendation
Ship if the PR branch only removes the broken import/helper block and unit tests stay green. Follow-up smoke should pass in CI once the browser loads `db.js` without the missing module error.

## Note
Subagent orchestration was attempted via `sessions_spawn`, but the gateway timed out before returning role outputs, so this memo was synthesized in the main lane using the required role lens.
