# Code Plan

## Patch
- File: `.github/workflows/deploy-preview.yml`
- Step: `Prune stale Firebase preview channels`
- Replace raw `gh api --paginate ... pulls?... --jq '.[].number'` with guarded `gh pr list --repo "${{ github.repository }}" --state open --limit 200 --json number --jq '.[].number'`.
- On discovery failure, log a warning and skip pruning before Firebase channel deletion begins.

## Rationale
Preview channel pruning is housekeeping. A GitHub API parsing failure should not block preview deployment, and it should not collapse to an empty open-channel list that could delete valid preview channels.

## Commit Message
Harden preview channel pruning
