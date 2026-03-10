Primary risk:
- Non-basketball games silently reset to `Q1`, creating inconsistent scoreboard state between tracker and viewer.

Regression targets:
- Basketball remains `Q1` by default.
- Explicit config periods still win over sport defaults.
- Replay/reset helpers do not mutate caller arrays.

Test plan:
- Add unit tests for shared sport-profile resolution.
- Extend reset helper tests for soccer/baseball defaults.
- Extend viewer state tests so reset fallback honors sport-specific defaults.
- Run targeted unit suites plus a broader live-tracker/live-game-related suite subset.

Manual spot-checks if time allows:
- Soccer game in `track-live.html` shows `H1` after reset.
- Baseball game viewer shows inning label instead of `Q1` on initial load/reset path.
