# QA Role (allplays-qa-expert)

## Coverage Focus
- Auto-selection without `gameId`.
- Ordering priority: live > scheduled-future-not-completed > recent fallback.

## Regression Guardrails
1. Live game still selected over all others.
2. Completed game within 3-hour window no longer selected as scheduled-future.
3. If no eligible future game, fallback still selects most recent non-cancelled game.

## Acceptance Criteria
- Scenario: Game A completed 30m ago, Game B scheduled +45m -> pick Game B.
- Scenario: only completed/cancelled historical games -> pick most recent non-cancelled historical game.
