Code plan:
1. Patch .github/workflows/deploy-preview.yml to remove invalid escape characters from the --jq filter.
2. Validate YAML and workflow snippet locally.
3. Commit only the workflow fix and required run notes.
