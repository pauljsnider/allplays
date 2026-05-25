# Requirements

## Acceptance Criteria
- `post-deploy-smoke` runs after a successful `deploy-prod` workflow on `master`.
- `post-deploy-smoke` does not run after `app-github-pages` succeeds without a real Pages deployment.
- Production smoke failures remain attributable to real production deploys or scheduled production monitoring, not stale production content.

## Exact Expected Change
Remove `app-github-pages` from `.github/workflows/post-deploy-smoke.yml` `workflow_run.workflows` unless a deploy-confirmed signal exists. No product behavior changes.
