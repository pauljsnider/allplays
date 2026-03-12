Primary regression areas:
- Config creation from `edit-config.html`
- Live tracking pages that depend on `config.columns`
- Existing game-report and analytics stat rendering

Test strategy:
- Unit tests for config normalization and derived leaderboard generation.
- Validate legacy config fallback.
- Validate derived stat precision, percentage formatting metadata, and ranking direction.
- Validate private/team-scope definitions are excluded from player leaderboard rendering.

Manual checks after patch:
1. Create a config with raw columns only.
2. Create a config with advanced derived definitions.
3. Open team analytics and confirm top-stat leaderboard cards render.
4. Open a player page and confirm the player’s rank/value shows for configured top stats.

Residual risk:
- No browser automation for the HTML pages.
- Existing historical data is aggregated seasonally at read time, not backfilled into stored derived docs.
