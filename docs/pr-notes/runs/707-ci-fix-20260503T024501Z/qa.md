# QA Notes

## QA Plan
- Run `GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=master node scripts/check-critical-cache-bust.mjs`.
- Run `npx vitest run tests/unit/team-pass.test.js` for the directly affected Team Pass module.

## Result
- Cache-bust guard passed locally.
- Team Pass unit test passed locally.
