# Architecture role notes

Current state:
- Last-read update happens from realtime snapshot callback in `team-chat.html`.
- Guard logic is centralized in `js/team-chat-last-read.js` via `shouldUpdateChatLastRead`.

Proposed state:
- Keep centralized guard function.
- Ensure call site passes visibility + focus signals.
- Keep function contract explicit and tested for required gating inputs only.

Risk/blast radius:
- Limited to team chat read-receipt behavior and tests.
- No schema/API changes.
