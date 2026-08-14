# Architecture

## Current-State Read

`getPublicTeamProfile` already enforces strict-public status and allow-lists `leagueUrl` plus `standingsConfig`. `getPublicTeamGamesProjection` independently enforces strict-public status and returns sanitized public games. The React adapter/service drops those fields and exposes no public-games method, leaving `PublicTeamDetail` identity-only.

## Proposed Design

- Add a direct callable adapter for `getPublicTeamGamesProjection`; never fall back to Firestore or authenticated loaders.
- Add a small native-standings adapter so the public route does not import the broad team-detail adapter dependency graph.
- Extend `PublicTeamProfile` only with validated league and standings metadata.
- Add an independent `getPublicTeamResults` service operation that requests one bounded projection page, rejects truncation as non-authoritative, defensively filters final games, computes native standings, and returns five recent results.
- Load profile and results independently so a results outage does not hide valid public identity.
- Render a compact responsive table, highlighted current row, recent-result list, empty state, and safe external league link.

## Files And Modules Touched

- `apps/app/src/lib/adapters/legacyPublicTeamsDb.ts`
- `apps/app/src/lib/adapters/legacyPublicStandings.ts`
- `apps/app/src/lib/publicTeamsService.ts`
- `apps/app/src/pages/PublicTeamDetail.tsx`
- Adjacent component, service, and smoke tests

## Data/State Impacts

Read-only. No schema, migration, cache, write, authentication, Functions, or Rules changes. The route adds one bounded anonymous callable after a valid public profile resolves.

## Security/Permissions Impacts

Functions remain the authorization and sanitization boundary. The page model omits summaries, media, opponent stats, roster, contacts, assignments, and private schedule fields. League URLs are protocol-validated.

## Failure Modes And Mitigations

- Projection failure or truncation: show a retryable inline state, not authoritative emptiness.
- Invalid or incomplete games: exclude from standings and results.
- Narrow screens: contain table width with horizontal overflow and nowrap cells.
- Name-based current-team matching: retain the existing engine contract; identity-aware standings are out of scope.
