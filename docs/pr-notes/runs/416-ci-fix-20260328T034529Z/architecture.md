Objective: restore deploy-preview comment reporting for PR 416.
Current state: workflow step builds a malformed jq filter for gh api, causing deploy-preview to fail after successful preview deployment.
Proposed state: use a valid jq filter so the workflow can find or create the preview URL comment.
Risk surface: GitHub Actions deploy-preview workflow comment-update logic only; no runtime app code changes.
Assumptions: gh CLI behavior matches CI log; no broader auth or preview deployment failure exists.
Recommendation: remove unnecessary backslash escaping inside the single-quoted --jq program.
