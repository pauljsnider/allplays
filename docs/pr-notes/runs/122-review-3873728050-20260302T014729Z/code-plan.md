# Code Role (manual fallback)

- Thinking level: medium (minimal safe patch).

## Plan executed
1. Add `js/live-stream-utils.js` with pure helpers for embed normalization and tab/panel visibility.
2. Update `edit-team.html` to normalize embed URLs without dropping query params.
3. Update `js/live-game.js` to track `hasVideoStream` and honor it in desktop/mobile visibility logic.
4. Update `test-youtube-stream.html` for parity with new embed normalization expectations.
5. Add regression tests in `tests/unit/live-stream-utils.test.js`.

## Conflict resolution across roles
- Requirements favored preserving all useful query params.
- Architecture favored centralization to avoid repeated logic drift.
- QA required executable guardrails, so utility extraction enabled direct unit tests.
- Final patch prioritized smallest cross-file change that satisfies all three.
