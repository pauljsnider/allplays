# QA Plan

## Validation
- Verify `javascript:` media hub highlight URLs do not produce a Play anchor or copyable URL.
- Verify generated relative highlight URLs still pass through because they resolve against the page origin.
- Verify HTTP and HTTPS clip URLs still render and copy.
- Run a syntax check for `js/live-game.js` because this repo has no automated test runner.

## Notes
- Role subagents were unavailable in this runtime, so QA analysis was completed inline.
