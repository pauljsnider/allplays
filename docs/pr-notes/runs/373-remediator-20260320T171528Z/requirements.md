Objective: remediate PR #373 review comments in `.github/workflows/deploy-preview.yml`.

Current state:
- `unit-tests` runs only for internal PRs, but it requires `npm ci` and `npm run test:unit:ci`.
- The repository has no `package.json` or lockfile, so `npm ci` fails before deployment can start.
- PR preview comment lookup calls `gh api .../issues/.../comments` without pagination.

Required change:
- Remove the manifest-dependent test gate so internal PR preview deploys can run in this static-site repo.
- Ensure preview comment lookup paginates before selecting the existing marker comment.

Constraints:
- Keep scope limited to the two review threads.
- Preserve existing internal-PR restriction and preview deploy behavior.
