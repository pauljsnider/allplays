# QA note

Acceptance criteria:
- `scripts/check-critical-cache-bust.mjs` passes for the PR diff.
- Existing unit coverage for homepage shared games still passes.

Validation:
- Run `GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=master node scripts/check-critical-cache-bust.mjs`.
- Run `npm run test:unit -- tests/unit/db-homepage-shared-games.test.js` for the affected db behavior.
