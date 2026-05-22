# Architecture Notes

## Acceptance Criteria
- Team chat still renders the default team-wide conversation when conversation listing is denied.
- Team chat scheduled reminder fallback messages render through the same realtime subscription path.
- Smoke stubs stay aligned with the production `team-chat.html` module import surface.

## Architecture Decisions
- No production architecture change needed. The fallback path in `team-chat.html` already catches `getChatConversations()` permission failures and builds the default team conversation from the loaded team.
- The failure is test drift: `team-chat.html` imports the new team email history helpers from `js/db.js`, but the smoke test DB stub does not export them, so the page module never initializes.

## Risks And Rollback
- Risk is limited to smoke test coverage. Adding no-op stub exports preserves current assertions and does not change app behavior.
- Rollback is reverting the test stub additions.
