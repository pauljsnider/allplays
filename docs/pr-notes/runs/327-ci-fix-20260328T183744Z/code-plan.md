# Code role

- Edit the deploy-preview workflow prune loop only.
- Wrap delete in conditional so 404/Not Found is ignored, but unexpected failures still exit non-zero.
- Keep change minimal and workflow-scoped.
