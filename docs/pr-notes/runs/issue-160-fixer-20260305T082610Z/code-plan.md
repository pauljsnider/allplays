# Code Role Plan (synthesized fallback)

Skill/tool note: `allplays-code-expert` subagent spawn unavailable; synthesized here.

## Planned Edits
1. `tests/unit/team-chat-last-read.test.js`
- Add tests for lifecycle retry predicate:
  - returns true with active view + message presence
  - returns false when no messages

2. `js/team-chat-last-read.js`
- Add `shouldRetryChatLastReadOnViewReturn` helper using existing active-view constraints plus message-presence.

3. `team-chat.html`
- Extract last-read write into shared guarded function.
- Invoke on snapshot and on `focus`/`visibilitychange` (visible only).

## Validation
- Run targeted unit test file for team-chat last-read policy.
