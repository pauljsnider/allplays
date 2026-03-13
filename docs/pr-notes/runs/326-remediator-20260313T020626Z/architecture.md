Current state:
- `deploy-preview.yml` swapped `FirebaseExtended/action-hosting-deploy` for a raw CLI invocation.
- That removed the built-in PR comment behavior while preserving the deploy itself.

Proposed state:
- The workflow remains CLI-driven for deployment.
- A follow-on GitHub API step reads the captured preview URL and updates one stable PR comment.

Controls and blast radius:
- Existing `pull-requests: write` permission is already present and sufficient for issue comment updates.
- No new secrets or external services are introduced.
- Comment updates are scoped to the triggering PR only.

Tradeoff:
- This restores the reviewer link with a small amount of workflow logic, but it does not recreate every side effect of the old action.
- That is acceptable because the review feedback is specifically about preview URL reporting.
