# QA Notes

## Regression Coverage
- Verify source includes strict boolean `isHome` handling for label selection.
- Verify `team - opponent` is not hard-coded into the rendered score caption.
- Verify neutral `home - away` label exists for fallback records.

## Test Command
```bash
npx vitest run tests/unit/scoreboard-widget.test.js
```

## Manual Spot Check
- Load `widget-scoreboard.html?teamId=<teamId>` with completed/live games.
- Confirm explicit home/away records show `team - opponent`.
- Confirm missing or non-boolean `isHome` records show `home - away`.
- Confirm upcoming games still omit scores.
