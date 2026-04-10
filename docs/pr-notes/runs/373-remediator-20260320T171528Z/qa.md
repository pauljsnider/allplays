Evidence:
- `rg --files -g 'package.json' -g 'package-lock.json' -g 'npm-shrinkwrap.json'` returned no files.
- Workflow currently invokes `npm ci` in both jobs.

Validation plan:
- Review the edited workflow YAML for syntax/indentation correctness.
- Confirm there are no remaining `unit-tests`, `needs: unit-tests`, or unpaginated `gh api` comment lookups.
- Manual runtime expectation: internal PRs can reach Firebase preview deploy; existing bot comment updates even when the PR has more than 30 comments.

Known limitation:
- No local automated GitHub Actions runner is configured in this repo, so validation is static review only.
