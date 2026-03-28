Implementation plan:
1. Update the prune step in `.github/workflows/deploy-preview.yml` to fetch all open PR numbers via paginated GitHub API calls.
2. Keep the current channel listing, filtering, and deletion loop unchanged apart from consuming the complete open-channel list.
3. Validate the workflow file with a YAML parse check.
4. Stage the workflow change and the run notes, then commit with a short imperative message.
