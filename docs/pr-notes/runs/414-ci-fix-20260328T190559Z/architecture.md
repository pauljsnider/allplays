Objective: restore `deploy-preview` by making preview-channel pruning resilient to stale list data.

Current state:
- Workflow lists Firebase preview channels, filters `pr-*`, and deletes channels for closed PRs.
- A channel can disappear between `hosting:channel:list` and `hosting:channel:delete`, causing a 404 and failing the whole deploy job.

Proposed state:
- Keep pruning behavior unchanged.
- Treat only Firebase delete 404/not-found responses as benign and continue pruning.
- Preserve hard-fail behavior for any other delete error.

Blast radius:
- Limited to `.github/workflows/deploy-preview.yml`.
- No application runtime or data model changes.

Assumptions:
- Firebase CLI output for the missing-channel case contains `HTTP Error: 404` or `Not Found`.
- Preview channel deletion is best-effort cleanup and should not block the deploy preview path.

Recommendation:
- Add targeted error handling around `hosting:channel:delete`.
- Do not broaden to `|| true`; that would hide real infra/auth failures.
