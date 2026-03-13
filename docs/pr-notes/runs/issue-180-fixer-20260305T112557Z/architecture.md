# Architecture role synthesis (local fallback)

## Current state
Tournament indicator is `competitionType: 'tournament'` on normal `teams/{teamId}/games/{gameId}` docs.

## Proposed state
Add `teams/{teamId}/brackets/{bracketId}` documents with embedded rounds/games/slots/source-rules:
- `status: 'draft' | 'published'`
- `format: 'single_elimination'`
- `seedOrder: []`
- `games: [{ id, roundIndex, status, homeSlot, awaySlot, winnerTeamId, loserTeamId, next: { winner, loser } }]`
- `publishedAt`, `publishedBy`

Add domain helpers in `js/bracket-management.js` for:
- bracket creation from seed list
- source-slot resolution
- auto-advance on result report
- published read model projection

Add db methods in `js/db.js` to CRUD/publish bracket docs.

## Blast radius
Low-to-medium. New collection path and new helper module only; existing game CRUD untouched.

## Controls
Rules gate writes to owner/admin only; published bracket reads remain public-safe.
