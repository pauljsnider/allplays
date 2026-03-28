# Architecture

- Objective: restore deploy-preview PR comment reporting.
- Current state: workflow passes an over-escaped jq filter to `gh api --jq`, causing parse failure before comment create/update.
- Proposed state: workflow uses a valid jq expression with normal shell single-quote protection.
- Risk surface: limited to PR preview comment update step in deploy-preview workflow.
- Blast radius: low; no application code or deployment behavior changes.
- Assumptions: GitHub CLI jq support behaves as in the failing log; existing auth/token scopes are valid.
