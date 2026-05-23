# Architecture notes

## Acceptance criteria
- `cache-bust-guard` must not require an authenticated network fetch when GitHub Actions has already checked out the pull request merge commit.
- The guard must still compare PR changes against the PR base, not just the last commit.

## Decision
Use the local pull request merge commit parent (`HEAD^1`) as the diff base when available. On `pull_request` events, `actions/checkout` checks out a synthetic merge commit by default; its first parent is the base branch commit and is sufficient for the cache-bust diff.

## Risk and rollback
- Risk: if a workflow checks out the PR head instead of the merge commit, `HEAD^1`/`HEAD^2` will not both exist. The script should retain the existing fetch path for that case.
- Rollback: revert the script change and fix workflow credentials/fetch behavior instead.
