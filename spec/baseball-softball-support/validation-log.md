# Baseball and Softball Support Validation Log

## Manual Test Plan

- Create a new baseball team and confirm `Baseball Standard` config appears with `AB, H, R, RBI, BB, FP`.
- Create a new softball team and confirm `Softball Standard` config appears with `AB, H, R, RBI, BB, FP`.
- Open `edit-config.html` and confirm baseball/softball quick templates populate name, base sport, and columns.
- Create a baseball/softball game, open standard tracking, record stats, update score, and save/complete.
- Open live tracking/live viewer for a baseball/softball game and confirm inning labels render as `T1/B1` style labels.
- Open `game-plan.html`, choose `Baseball 9` and `Softball 10`, assign defensive positions, set batting order, save, reload, and confirm persistence.
- Open `drills.html` for baseball and softball teams and confirm sport-relevant drill categories and starter drills appear.

## Results

### 2026-05-10

- Added focused unit coverage for sport stat templates, baseball/softball inning labels, run-score finalization, game-plan interop, and practice starter drills.
- Ran `npx vitest run tests/unit/live-tracker-integrity.test.js tests/unit/sport-templates.test.js tests/unit/live-sport-config.test.js tests/unit/game-plan-interop.test.js tests/unit/practice-starter-drills.test.js`: 5 files passed, 25 tests passed.
- Ran `npm test`: 81 files passed, 399 tests passed.
- Ran `git diff --check` with no whitespace errors.
- Used local static server at `http://localhost:8000` to confirm edited pages return 200: `edit-team.html`, `edit-config.html`, `track.html`, `track-live.html`, `live-tracker.html`, `live-game.html`, `game-plan.html`, `game-day.html`, and `drills.html`.
- Confirmed static page content includes baseball/softball config templates, game-plan formations, batting order UI, starter drill import, and dynamic period selector wiring.
- Double-check fixed run scoring in live final-score reconciliation and removed basketball-only multi-point buttons from run/goal tracking paths.
- Authenticated Firebase-backed create/save flows still need real-account manual verification.
