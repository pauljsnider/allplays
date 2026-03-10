# QA Role Notes (Issue #227 Post-game insights)

## Objective
Prove the new insights are generated deterministically from existing stats/events and fail safely when data is sparse.

## Automated Validation
- `npm test -- tests/unit/post-game-insights.test.js`
- `npm test`

## Manual Validation Checklist
1. Open a completed game with play-by-play data and confirm the new Insights section renders above the existing tables/log.
2. Confirm team insights mention score share, momentum, discipline, or rotation only when the underlying data exists.
3. Click from the game report to a player page and confirm the selected game renders player-specific insights.
4. Open a sparse completed game with little or no event data and confirm the empty-state copy is shown instead of broken cards.

## Residual Risk
- Event text formats vary, so some momentum/clutch insights are intentionally conservative.
- Client-side generation means insights are recomputed per page load rather than persisted.
- Non-basketball trackers may yield fewer insight types until sport-specific extractors are added.
