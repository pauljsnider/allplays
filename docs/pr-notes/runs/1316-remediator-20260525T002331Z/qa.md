# QA Plan

## Validation
- Inspect `.github/workflows/post-deploy-smoke.yml` and confirm `workflow_run.workflows` contains `deploy-prod` only.
- Inspect `.github/workflows/app-github-pages.yml` and confirm deploy remains conditional, so it is not safe as a whole-workflow trigger.
- Run the relevant fast test gate from repo guidance: `npm test`.

## Negative Checks
- A successful `app-github-pages` build-only run should not trigger `post-deploy-smoke`.
- A failed or cancelled `deploy-prod` run should continue to be blocked by the existing job `if` guard.
