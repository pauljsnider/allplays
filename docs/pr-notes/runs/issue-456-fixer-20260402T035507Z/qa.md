# QA Role (allplays-qa-expert)

## Test Strategy
1. Reproduce the bug at the homepage layer with one cancelled upcoming game and one valid upcoming game.
2. Assert the cancelled game does not appear in rendered markup and does not contribute a `live-game.html` link.
3. Run the focused homepage unit test file, then run the repo unit suite if the focused test is clean and execution time is reasonable.

## Regression Guardrails
- Preserve rendering for non-cancelled upcoming cards.
- Preserve dedupe behavior between live and upcoming lists.
- Preserve empty-state messaging when every upcoming item is filtered out.

## Manual Smoke
- Cancel a game scheduled within seven days.
- Load `index.html`.
- Confirm the cancelled game card is absent from "Live & Upcoming Games".
