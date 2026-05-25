# Code Plan

## Files
- `widget-scoreboard.html`
- `tests/unit/scoreboard-widget.test.js`

## Change Plan
1. Add `scoreLabel` in `renderGame` using strict boolean detection.
2. Replace hard-coded `team - opponent` caption with `${scoreLabel}`.
3. Update static unit assertions to cover strict boolean label logic and neutral fallback label.

## Commit Scope
Only the review feedback for PR thread `PRRT_kwDOQe-T586Ea8OA` is addressed.
