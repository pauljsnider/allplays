Coverage target: replay initialization for completed games in `live-game.html` with `replay=true`.

Test cases:
- Empty replay events: final score remains visible, replay controls show, chat input is disabled, replay locked notice is visible.
- Replay events present: replay startup applies the same chat lockout and does not leave chat enabled.

Regression guardrails:
- Keep assertions on user-visible DOM state, not just helper return values.
- Run the new replay init test file and the existing `live-game-chat` helper test together.
