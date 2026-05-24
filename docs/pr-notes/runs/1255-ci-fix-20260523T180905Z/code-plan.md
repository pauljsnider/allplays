# Code plan

## Minimal implementation
- Add helpers to detect local commit refs and the pull request merge base parent.
- In `getDiffBase()`, for `pull_request` events, prefer `HEAD^1...HEAD` when `HEAD` has both merge parents.
- Keep the existing `origin/<base>...HEAD` fetch path as fallback for non-merge checkout modes.

## Files
- `scripts/check-critical-cache-bust.mjs`
