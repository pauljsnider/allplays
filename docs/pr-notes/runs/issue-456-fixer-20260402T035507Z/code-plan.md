# Code Role (allplays-code-expert)

## Plan
1. Add a homepage regression test covering cancelled upcoming games.
2. Filter cancelled items from homepage upcoming rendering.
3. Tighten `getUpcomingLiveGames()` to exclude cancelled records at the data source.
4. Run focused Vitest coverage for the homepage workflow and commit with issue reference.

## Non-Goals
- No redesign of cancelled-game presentation on `live-game.html`.
- No broader schedule status refactor.
