# QA Notes

## QA Plan
- Run `node scripts/check-critical-cache-bust.mjs` with PR environment variables matching CI: `GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=master`.
- Confirm only cache-bust import lines and role notes changed.

## Expected Result
- Cache-bust guard passes because the diff now contains matching `db.js?v=<n>` import updates.
