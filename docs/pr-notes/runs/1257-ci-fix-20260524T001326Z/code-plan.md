# Code Plan

## Files responsible
- `scripts/check-critical-cache-bust.mjs`

## Patch plan
1. Keep existing changed-file detection.
2. Filter cache-bust rules to only critical files present in the PR diff.
3. Exit successfully before reading patch text when no critical files changed.
4. For critical files, read targeted diffs only, preventing lockfile-sized diffs from filling the Node child-process buffer.

## Checks
Run the guard locally with pull request environment variables against `master`.

## Implemented
- Guard now reads targeted critical-file diffs instead of the full PR diff.
- React app smoke specs now use `SMOKE_APP_BASE_URL` consistently for app routes.
- Messages smoke mock now exports `uploadTeamChatAttachment`, matching the current chat service surface used by app shell imports.
