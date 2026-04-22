# Code Role (allplays-code-expert)

## Implementation Plan
1. Update the pull request fetch path in `scripts/check-critical-cache-bust.mjs` to refresh `origin/<baseRef>` without `--depth=1`.
2. Leave all diff and cache-bust rule logic unchanged.
3. Validate the script in PR mode from a clean repo clone.

## Exact Change
Replace the shallow fetch command:
- from: `git fetch origin <baseRef> --depth=1`
- to: `git fetch origin <baseRef>:refs/remotes/origin/<baseRef>`

## Validation Commands
- `GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=master node scripts/check-critical-cache-bust.mjs`
- `git diff --stat`
