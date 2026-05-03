# Architecture

## Decision
Add explicit participation provenance to score-sheet import aggregate stat rows, and make player-profile participation detection honor that marker before falling back to time/stat inference.

## Precedence
1. `didNotPlay === true` excludes the row.
2. `participated === true` or `participationStatus === 'appeared'` includes the row.
3. `participationStatus === 'unused'` excludes the row.
4. Legacy fallback includes positive `timeMs` or any non-zero stat.
5. Otherwise exclude.

## Data Impact
New optional fields on `teams/{teamId}/games/{gameId}/aggregatedStats/{playerId}`:
- `participated: true`
- `participationStatus: 'appeared'`
- `participationSource: 'statsheet-import'`

No Firestore rules change. No tenant boundary change. Legacy ambiguous imported zero-stat rows remain ambiguous unless re-imported or migrated.
