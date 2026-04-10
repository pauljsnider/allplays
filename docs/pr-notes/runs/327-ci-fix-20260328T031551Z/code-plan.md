Thinking level: low
Reason: the CI log identifies a deterministic quoting bug in a single workflow step.

Plan:
1. Patch `.github/workflows/deploy-preview.yml` to remove escaped quotes from the jq expression.
2. Validate the filter locally with representative JSON and `jq`.
3. Stage the modified files and commit with the required CI-fix message.
