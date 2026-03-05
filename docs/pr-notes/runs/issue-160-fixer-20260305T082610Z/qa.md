# QA Role (synthesized fallback)

Skill/tool note: `allplays-qa-expert` subagent spawn unavailable; synthesized here.

## Regression Guardrails
- Unit test should assert lifecycle retry policy only marks read when:
  - user exists
  - team exists
  - page visible
  - window focused
  - at least one message is present
- Ensure negative cases remain blocked (hidden, unfocused, no messages).

## Manual Validation Targets
1. Open chat as User A, send new message from User B while A is viewing chat.
2. Switch focus away/back, read message, navigate to dashboard.
3. Confirm unread badge is cleared.
