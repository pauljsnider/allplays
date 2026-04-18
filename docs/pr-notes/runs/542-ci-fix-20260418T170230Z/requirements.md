# Requirements Role (allplays-requirements-expert)

## Objective
Restore the PR cache-bust guard so it can inspect changed files without crashing on a missing merge base.

## Acceptance Criteria
1. In pull_request context, `scripts/check-critical-cache-bust.mjs` no longer fails just because the script shallow-fetches the base branch.
2. The guard still diffs the PR branch against `origin/<baseRef>` and keeps the existing cache-bust rule checks unchanged.
3. The fix is limited to the CI guard path. No product behavior changes.

## Non-Goals
- No change to cache-bust rule definitions.
- No change to workflow triggers or unrelated CI jobs.

## Risks
- If the repository checkout itself is missing required history, diffing may still fail for reasons outside this script.

## Rollback
Revert the single script change and remove these notes if the fetch behavior causes an unexpected CI regression.
