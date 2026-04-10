Scope: validate only the deploy-preview workflow change.

Checks:
- Confirm the failure log maps to the jq filter in `.github/workflows/deploy-preview.yml`.
- Ensure the updated filter uses valid jq string literals without stray backslashes.
- Run `git diff --check` after editing to catch syntax or whitespace regressions in the workflow file.

Residual risk:
- Full end-to-end validation requires GitHub Actions execution because the affected command depends on `gh api` against a live PR.
