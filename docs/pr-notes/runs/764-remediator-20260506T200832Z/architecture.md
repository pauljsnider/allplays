# Architecture notes

## Architecture decisions
- Keep clip aggregation centralized in `collectPlayerVideoClips` in `js/player-profile-stats.js`.
- Treat `game.clipMetadata` and `game.clips` as additional normalized input collections, not separate rendering paths.
- Continue to use the existing player matching, hidden/deleted filtering, replay URL construction, and URL safety guards.

## Risks and rollback
- Risk surface is limited to player profile video clip collection.
- Blast radius is low because the current implementation only adds two array sources to the existing clip pipeline.
- Rollback is the PR commit that added the two source arrays and corresponding tests.
