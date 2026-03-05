# Code Role Notes
- Edit only `team.html` in `buildNativeStandingsSnapshot`.
- Add local `isHome` boolean derivation (`game?.isHome !== false`) and map home/away teams from it.
- Keep score fields unchanged; rely on persisted homeScore/awayScore orientation.
- Run lightweight validation (diff + optional grep) and commit.
