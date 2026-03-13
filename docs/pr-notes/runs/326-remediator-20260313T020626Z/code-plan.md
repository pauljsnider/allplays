Plan:
1. Update `.github/workflows/deploy-preview.yml` so the deploy step runs with `--json`, stores the result, and exports `preview_url`.
2. Add a minimal `actions/github-script` step that upserts a PR comment using a stable hidden marker.
3. Validate the workflow with `actionlint`.
4. Commit only the targeted workflow change plus required run notes.
