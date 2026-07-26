# Public Team API v1

The public team API exposes a small, read-only projection for websites that
need a current roster or game schedule. A team must have `isPublic: true` and
must not be inactive. Missing, private, and inactive teams all return the same
generic `404` response.

Base URL:

`https://us-central1-game-flow-c6311.cloudfunctions.net`

## Roster

`GET /publicTeamRosterV1?teamId={teamId}`

```json
{
  "version": 1,
  "generatedAt": "2026-07-26T12:00:00.000Z",
  "team": {
    "id": "team-id",
    "name": "Team name",
    "sport": "Soccer",
    "photoUrl": null
  },
  "players": [
    {
      "id": "player-id",
      "name": "Player name",
      "number": "10",
      "photoUrl": null,
      "position": null
    }
  ]
}
```

Only active roster members are returned. Contact details, parent links,
tracking information, notes, and authorization fields are never projected.

## Games

`GET /publicTeamGamesV1?teamId={teamId}&from={YYYY-MM-DD}&to={YYYY-MM-DD}&limit={1-500}`

`from`, `to`, and `limit` are optional. The default range is one year back
through two years ahead, with a default limit of 100. A requested range cannot
exceed 3,660 days.

```json
{
  "version": 1,
  "generatedAt": "2026-07-26T12:00:00.000Z",
  "team": {
    "id": "team-id",
    "name": "Team name",
    "sport": "Soccer",
    "photoUrl": null
  },
  "range": {
    "from": "2026-01-01",
    "to": "2026-12-31",
    "truncated": false
  },
  "games": [
    {
      "id": "game-id",
      "startsAt": "2026-07-31T15:00:00.000Z",
      "endsAt": null,
      "opponent": "Opponent",
      "location": "Public field name",
      "isHome": true,
      "status": "scheduled",
      "teamScore": null,
      "opponentScore": null,
      "result": null,
      "seasonLabel": null,
      "competitionType": null,
      "countsTowardSeasonRecord": true,
      "summary": null,
      "videoUrl": null
    }
  ]
}
```

Only game events are included. Private and deleted events are excluded.
Imported arrival-time and assignment text is removed from public locations.
RSVPs, assignments, notes, member identities, and internal event data are never
projected.

## HTTP behavior

- Methods: `GET`, `HEAD`, and `OPTIONS`
- CORS: public read access (`Access-Control-Allow-Origin: *`), no credentials
- Cache: one minute in a browser and five minutes in a shared cache, with no
  stale serving after expiration
- Rate limit: 120 requests per minute per observed client IP and function
  instance
- Errors: `{ "error": { "code": "...", "message": "..." } }`

Expected statuses are `400`, `404`, `405`, `429`, and `500`.

The existing public calendar subscription remains available at:

`GET /publicTeamGamesIcs?teamId={teamId}`
