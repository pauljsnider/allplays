# Architecture Notes

## Decision
Use `game.isHome` as authoritative only when `typeof game.isHome === 'boolean'`.

## Implementation
- Keep the existing score ordering calculation for explicit home/away state.
- Add a `scoreLabel` value in `renderGame`.
- Render `team - opponent` only for explicit boolean `isHome`.
- Render neutral `home - away` for missing or non-boolean `isHome`.

## Impact
- No data model change.
- No Firebase writes or security rule impact.
- Blast radius is limited to public scoreboard score caption text.
