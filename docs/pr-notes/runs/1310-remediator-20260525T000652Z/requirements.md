# Requirements Notes

## Acceptance Criteria
- Completed or live games still display a score.
- When `game.isHome` is explicitly `true`, the score is labeled `team - opponent` and uses home score first.
- When `game.isHome` is explicitly `false`, the score is labeled `team - opponent` and uses away score first.
- When `game.isHome` is missing or non-boolean, the score uses home/away ordering and a neutral `home - away` label.

## Edge Cases
- `undefined`, `null`, strings, and numeric values for `isHome` must not imply team/opponent orientation.
- Upcoming games still hide score output.
