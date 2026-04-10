Thinking level: low
Reason: the CI log identifies a single malformed jq expression and the fix is a localized workflow edit.

Plan:
1. Update the `gh api --jq` expression in `.github/workflows/deploy-preview.yml` to remove invalid escaping.
2. Verify the diff is limited to the workflow and required run notes.
3. Run lightweight validation for the edited file.
4. Commit with the required `fix:address-ci-failure:` prefix.
