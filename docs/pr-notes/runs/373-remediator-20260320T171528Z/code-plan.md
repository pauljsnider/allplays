Implementation plan:
1. Remove the `unit-tests` job from `.github/workflows/deploy-preview.yml`.
2. Remove the `needs: unit-tests` dependency from `deploy`.
3. Remove manifest-dependent `npm ci` from `deploy` while retaining Node setup for `npx firebase-tools`.
4. Update the PR comment lookup command to use `gh api --paginate`.
5. Re-read the workflow and inspect the diff before committing.
