# Architecture Role

## Current-State Read

- `functions/public-team-api-core.cjs` already sanitizes profile configuration and public games and requires a strict public team for game projections.
- `publicTeamsService.ts` drops league/standings fields and exposes no standings-ready projections.
- `legacyPublicTeamsDb.ts` lacks a typed public-games callable boundary.
- `js/db.js` has a fallback helper, but routing through `getGames` can return canonical authenticated data before fallback.
- `getPublicTeamProfile` can return a managed document to an authenticated admin, so the public service must explicitly require `isPublic === true` and reconstruct its output.
- The native engine accepts `homeTeam`, `awayTeam`, `homeScore`, `awayScore`, and final `status`.

## Proposed Design

- Add a dedicated paginated `getPublicTeamGamesProjection` adapter using only the public callable.
- Require a public, active, identity-matching profile before returning public detail.
- Reconstruct `leagueUrl` and `standingsConfig` field by field.
- Add `getPublicTeamStandingsInputs(teamId)` that validates the callable response team and maps eligible games to native-compatible inputs with dates and allow-listed tournament metadata.
- Orient names and scores using `isHome`.
- Reject non-final, practice, private, deleted, mismatched, malformed, nameless, dateless, or invalid-score projections.
- Do not invoke or modify the native standings algorithm in this slice.

## Files And Modules Touched

- `apps/app/src/lib/publicTeamsService.ts`
- `apps/app/src/lib/adapters/legacyPublicTeamsDb.ts`
- `tests/unit/app-public-teams-service.test.ts`
- This run's four role artifacts.
- No changes to `functions/public-team-api-core.cjs`, `js/db.js`, UI, or `js/native-standings.js`.

## Data/State Impacts

- Read-only. No schema, index, persisted state, publishing, or new query changes.
- Existing callable pagination is followed with missing/repeated cursor detection.
- The normalized model is stable and directly compatible with the existing native engine.

## Security/Permissions Impacts

- The Functions public boundary stays authoritative.
- Client defense in depth rejects private managed-profile responses and mismatched projection teams.
- Raw profiles, configs, games, and tournament objects are never spread into service results.
- No new permissions or canonical Firestore reads are introduced.

## Failure Modes And Mitigations

- Private admin profile: reject before exposing detail.
- Contract drift: explicit reconstruction drops unknown fields.
- Scores on scheduled/live games: status filtering excludes them.
- Malformed game: omit only that game.
- Missing/repeated cursor: throw instead of treating partial data as complete.
- Large cache-bust blast radius: leave `js/db.js` unchanged.
