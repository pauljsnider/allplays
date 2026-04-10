Objective: prevent the preview-channel prune step from deleting active channels for open PRs beyond the first 200 returned by `gh pr list`.

Current state: `.github/workflows/deploy-preview.yml` uses `gh pr list --state open --limit 200` and treats any `pr-*` channel not in that truncated set as stale.
Proposed state: fetch the full open PR number set with pagination before comparing against existing Firebase preview channels.

Risk surface:
- A false stale classification deletes a live preview channel and breaks PR preview links.
- Blast radius is limited to preview-channel cleanup in the deploy workflow.

Assumptions:
- `gh api` is available in the GitHub Actions runner through the GitHub CLI.
- Repository open PR count can exceed 200, so pagination is required.
- Minimal change is preferred over broader workflow refactoring.

Recommendation: replace the capped `gh pr list` call with paginated GitHub API retrieval of open PR numbers and preserve the rest of the pruning logic.
