Objective: restore PR preview comment reporting in the deploy-preview workflow.

Current state:
- Firebase preview deploy completes and exports `PREVIEW_URL`.
- The follow-up `gh api --jq` call fails before it can patch or create the PR comment.

Proposed state:
- Keep the existing workflow shape and comment behavior.
- Pass a valid jq expression to `gh api` without shell-escaped quotes leaking into jq.

Risk surface and blast radius:
- Limited to `.github/workflows/deploy-preview.yml`.
- No runtime app impact. Only the preview-commenting step changes.

Assumptions:
- `gh api --jq` expects raw jq syntax, not backslash-escaped quotes.
- Existing GitHub token permissions remain sufficient once parsing succeeds.

Recommendation:
- Apply the minimal quoting fix in the workflow rather than restructuring the job.
- This preserves behavior and minimizes regression risk.
