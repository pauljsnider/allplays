Objective: restore the PR preview comment step in the deploy-preview workflow.

Current state: the workflow shells out to `gh api ... --jq '...'`, but the jq program includes backslash-escaped double quotes inside a single-quoted shell string.
Proposed state: keep the workflow behavior unchanged and pass a valid jq program string to `gh` by removing the unnecessary escaping.

Risk surface: one workflow step in `.github/workflows/deploy-preview.yml`.
Blast radius: limited to the PR comment update logic after a successful preview deploy.

Assumptions:
- `gh api --jq` expects a normal jq program, not shell-escaped quotes.
- No other deploy-preview behavior needs to change because the deploy itself succeeded and only comment reporting failed.

Recommendation: patch the jq filter in place. This is the smallest change that preserves existing behavior and control flow.
