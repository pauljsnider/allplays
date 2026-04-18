## Minimal Patch Plan

1. Treat `track.html` aggregated-stats write logic as the source of truth.
2. Update only `buildAggregatedStatsWrites()` in `test-track-zero-stat-player-history.js` to mirror that logic exactly:
   - pre-normalize incoming `playerStats` keys to lowercase,
   - resolve configured columns from that lowercase map,
   - preserve non-config stats only when neither the original key nor its lowercase form is already present.
3. Add one focused regression test proving mixed-case source keys like `PTS` / `ReB` still land as lowercase configured stats without duplicate keys.

## Concrete Changes

- In `test-track-zero-stat-player-history.js`, inside `buildAggregatedStatsWrites()`:
  - add `playerStatsByLowerKey = {}`.
  - populate it with `String(statKey).toLowerCase()` keys and numeric values.
  - replace `Number(playerStats[key]) || 0` with a lookup against `playerStatsByLowerKey` using `hasOwnProperty`.
  - tighten the preservation guard from:
    - `normalizedStats[statKey] === undefined`
    to:
    - `normalizedStats[statKey] === undefined && normalizedStats[normalizedKey] === undefined`
- Add the mixed-case regression:
  - input: `{ PTS: 8, ReB: 5, ast: 2 }`
  - expected saved stats: `{ pts: 8, reb: 5, ast: 2 }`

## Validation Commands

```bash
cd /tmp/allplays-pr557
node test-track-zero-stat-player-history.js
```

```bash
cd /tmp/allplays-pr557
python3 - <<'PY'
from pathlib import Path
track = Path('track.html').read_text()
test = Path('test-track-zero-stat-player-history.js').read_text()
needles = [
    'const playerStatsByLowerKey = {};',
    "playerStatsByLowerKey[String(statKey).toLowerCase()] = Number(value) || 0;",
    "normalizedStats[key] = Object.prototype.hasOwnProperty.call(playerStatsByLowerKey, key)",
    "if (normalizedStats[statKey] === undefined && normalizedStats[normalizedKey] === undefined) {"
]
for n in needles:
    print(('OK' if n in track and n in test else 'MISSING') + ' :: ' + n)
PY
```

## Notes

- The helper logic and `track.html` now match on the case-normalization flow.
- The targeted helper test passes with all 4 assertions green.
- This keeps scope tight to the review comment and avoids touching unrelated tracker behavior.
