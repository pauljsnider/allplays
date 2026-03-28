Coverage target:
- Completed-game replay entry path
- Replay bootstrap without play-by-play data
- Replay timeline gating for events and chat

Guardrails:
- Assert final score comes from the completed game doc, not replay events.
- Assert replay mode disables chat input in fallback mode.
- Assert replay event ordering is stable after sorting by `gameClockMs`.
- Assert chat stays hidden before its timestamp and appears at or after its timestamp.

Validation plan:
- Run the new replay unit test file directly.
- Run the existing `tests/unit/live-game-replay-speed.test.js`.
- Run the existing `tests/unit/live-game-chat.test.js`.
