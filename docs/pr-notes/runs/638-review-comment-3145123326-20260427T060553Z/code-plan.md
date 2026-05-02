# Code Plan

## Implementation Plan
- Update `js/player-profile-stats.js` so explicit participation markers count all-zero appearances while `didNotPlay` remains highest precedence.
- Update `js/track-statsheet-apply.js` so included mapped home rows write `participated: true`, `participationStatus: 'appeared'`, and `participationSource: 'statsheet-import'`.
- Add unit coverage in `tests/unit/player-profile-stats.test.js` for explicit zero-stat appearances, explicit unused rows, and DNP precedence.
- Add unit coverage in `tests/unit/track-statsheet-apply.test.js` proving zero-stat included imports emit the marker.
- Bump static import cache params in `player.html` and `track-statsheet.html`.

## Conflict Resolution
Requirements and QA preferred an explicit participation marker to avoid counting unused roster placeholders. Architecture recommended `participationStatus`/`participationSource`; code lane proposed `participated: true`. Chosen direction uses both `participated: true` for compatibility/simple checks and structured status/source fields for provenance.

## Rollback
Revert the follow-up commit. Existing PR behavior returns to stats/time-only participation filtering.
