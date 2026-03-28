Objective: keep `deploy-preview` from failing when Firebase preview channels disappear between list and delete.

Current state: the prune loop treats every `hosting:channel:delete` failure as fatal.
Proposed state: ignore only the expected `404 Not Found` delete race and preserve hard failure for other errors.

Risk surface: limited to `.github/workflows/deploy-preview.yml`.
Blast radius: only PR preview channel pruning before deploy.

Assumptions:
- The failing `404` is caused by stale channel state or concurrent deletion outside this job.
- A missing stale preview channel is safe to treat as already-pruned.

Recommendation: wrap channel deletion, capture stderr/stdout, and continue only when Firebase reports channel not found.
