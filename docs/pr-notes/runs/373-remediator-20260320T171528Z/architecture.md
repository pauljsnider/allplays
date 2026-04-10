Current state:
- `deploy` currently depends on a separate `unit-tests` job that assumes a Node package workflow.
- The preview comment update logic depends on the first page of issue comments only.

Proposed state:
- Collapse the preview workflow to a single `deploy` job for internal PRs.
- Keep Node setup in `deploy` because `firebase-tools` is executed with `npx`.
- Use `gh api --paginate` when reading existing PR comments, then select the marker comment ID.

Risk surface and blast radius:
- Blast radius is isolated to preview deployment automation.
- Removing the `needs: unit-tests` dependency restores deployability in a manifest-free repo.
- Pagination change reduces duplicate comment risk on long-lived PRs without altering comment body format.
