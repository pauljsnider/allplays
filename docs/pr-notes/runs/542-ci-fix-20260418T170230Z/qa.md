# QA Role (allplays-qa-expert)

## QA Plan
1. Run the guard script directly after the change in a repository state that exercises pull_request mode.
2. Verify the script still passes in a normal local invocation when no critical files changed without matching cache-bust updates.
3. Confirm the patch is limited to the CI guard script plus required run notes.

## Edge Cases
- PR branches that are behind `master` and need merge-base history.
- Repositories where a prior shallow fetch has already truncated local history.
- Push events should keep using `HEAD^...HEAD` unchanged.

## Exit Criteria
- `GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=master node scripts/check-critical-cache-bust.mjs` succeeds in a clean repo with related history.
- No unrelated files are modified.
