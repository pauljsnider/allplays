# Requirements role notes

## Objective
Resolve all unresolved PR #24 review threads with minimal, targeted code changes in the nightly Playwright smoke runner.

## Required outcomes by thread
- PRRT_kwDOQe-T585v5gUI: Ensure Slack token cannot leak in curl-related failure logging paths.
- PRRT_kwDOQe-T585v5gUJ: Ensure placeholder/example values are clearly non-production and blocked when Slack notifications are enabled.
- PRRT_kwDOQe-T585v5gUK: Ensure test command execution avoids `bash -lc` and direct argv execution remains in place.
- PRRT_kwDOQe-T585v5gUM: Ensure lock fd is closed on all paths via EXIT trap.

## Constraints
- Keep blast radius to `scripts/nightly-playwright-smoke.sh` and `config/nightly-playwright-smoke.env.example`.
- No unrelated refactor.
- Validate with shell syntax check and focused inspection.
