# Architecture role

- Root cause: workflow deletes stale Firebase preview channels and exits on 404.
- Current state: delete command is fatal for already-missing channels.
- Proposed state: treat missing channel deletion as non-fatal while keeping other errors fatal.
- Blast radius: GitHub Actions deploy-preview workflow only.
