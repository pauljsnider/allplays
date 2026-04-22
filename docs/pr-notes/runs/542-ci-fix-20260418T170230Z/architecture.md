# Architecture Role (allplays-architecture-expert)

## Root Cause
The cache-bust guard runs `git diff origin/master...HEAD`, which requires a merge base. In pull request runs, the script first refreshes `origin/master` with `--depth=1`, which can truncate the base branch history and remove the merge base needed for a triple-dot diff.

## Architecture Decisions
- Keep the existing `origin/<baseRef>...HEAD` diff strategy.
- Stop using a shallow fetch for the base ref refresh.
- Refresh the remote-tracking ref explicitly so the diff runs against the current base branch tip.

## Files
- `scripts/check-critical-cache-bust.mjs`

## Risks
- Very low blast radius. Change is isolated to CI guard git-fetch behavior.
- If checkout history is fundamentally broken upstream, this script still cannot repair that.
