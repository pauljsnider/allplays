Validation target: workflow shell logic still parses as YAML and the prune step now accounts for all open PRs.

Checks:
- Review the updated shell snippet for `set -euo pipefail` safety and quoting.
- Parse `.github/workflows/deploy-preview.yml` with YAML tooling.
- Confirm no unrelated workflow behavior changed.

Residual risk:
- This is not a full GitHub Actions execution, so runtime behavior depends on `gh api --paginate` remaining available in the runner environment.
- Manual/live validation would require a PR workflow run, which is outside this remediation step.
