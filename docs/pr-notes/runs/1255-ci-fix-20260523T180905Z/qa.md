# QA notes

## Validation plan
- Run the guard normally: `node scripts/check-critical-cache-bust.mjs`.
- Simulate a pull request environment with `GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=master node scripts/check-critical-cache-bust.mjs`.
- Run the fast unit suite if dependency state allows: `npm test -- --run` or repo-defined `npm test`.

## Expected behavior
- The guard passes without attempting a network fetch when local PR merge parents exist.
- Existing cache-bust detection behavior remains unchanged for changed critical files.
