Objective: Restore automatic preview URL visibility on PR deploys in `.github/workflows/deploy-preview.yml`.

Current state:
- The workflow deploys Firebase Hosting previews with `firebase-tools`.
- The deploy succeeds, but no PR comment or other PR-facing URL is published.

Proposed state:
- Keep the Node 24-compatible `firebase-tools` deploy path.
- Restore PR-facing URL reporting by publishing the deployed preview URL back to the PR.

Assumptions:
- `firebase hosting:channel:deploy --json` returns a top-level `url` field on success.
- A PR comment is sufficient to restore the documented reviewer workflow.

Risk surface and blast radius:
- Scope is limited to the preview deploy workflow for same-repo PRs.
- Failure mode is limited to comment publication after a successful deploy; it does not affect production deploys.

Recommendation:
- Capture the deploy JSON output and upsert a single PR comment identified by a hidden marker.
- Avoid broader workflow refactors or reverting to the deprecated action.
