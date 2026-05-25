# Code Plan

## Implementation Plan
1. Edit `.github/workflows/post-deploy-smoke.yml`.
2. Remove `app-github-pages` from `on.workflow_run.workflows`.
3. Leave the existing `deploy-prod` trigger, branch guard, checkout SHA, and production smoke command unchanged.

## Validation Commands
- `npm test`
- `git diff --check`

## Rollback
Revert this commit if a deploy-confirmed GitHub Pages smoke trigger is implemented separately.
