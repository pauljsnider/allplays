Validation target:
- Confirm ordinary game document snapshots do not reset video playback position.
- Confirm actual video source or mode changes still refresh the player.

Repo constraint:
- `AGENTS.md` and `CLAUDE.md` state there is no automated test runner in this repo.
- Available validation is manual-test guidance plus lightweight repository checks.

Planned checks:
- Review the diff for the live snapshot path.
- Run `git diff --check` to catch patching issues.
