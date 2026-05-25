# Architecture

## Decision
Keep `post-deploy-smoke` tied only to `deploy-prod`, because `workflow_run` observes whole workflow success and cannot prove that the conditional `app-github-pages` deploy job actually ran.

## Risk Surface
- Current risk: `app-github-pages` can build successfully while deployment is skipped, then production smoke checks stale `https://allplays.ai` content.
- Proposed risk: Pages-specific deploys will not automatically trigger this production smoke unless covered by a future deploy-confirmed workflow.

## Minimal Change
Edit only `.github/workflows/post-deploy-smoke.yml` and remove `app-github-pages` from the trigger list.
