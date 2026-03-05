# Architecture Role Notes
- Current state: `buildNativeStandingsSnapshot()` maps each game with `homeTeam = teamName` and `awayTeam = opponent` regardless of venue.
- Risk: For away games that store true home/away scores, standings engine interprets results backwards.
- Proposed state: Map `homeTeam`/`awayTeam` conditionally using `game.isHome` when provided.
- Blast radius: Limited to native standings snapshot transformation in `team.html`.
