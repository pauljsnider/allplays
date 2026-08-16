# Architecture

## Current-State Read

- `PublicTeamDetail.tsx` loads only the allow-listed public profile.
- #4690 added normalized `standingsConfig`, sanitized `leagueUrl`, and a fully paginated `getPublicTeamStandingsInputs` boundary.
- `js/native-standings.js` already owns ranking, scoring, goal-differential, and tiebreaker behavior.

## Proposed Design

- Resolve the public profile first and render it independently.
- Request sanitized standings inputs only when `standingsConfig.enabled` is true.
- Pass those inputs and the normalized config unchanged to `computeNativeStandings` through a narrow public-team adapter export.
- Track standings loading, ready, empty, and unavailable state separately from profile loading.
- Render a full-width fixed-layout four-column table with wrapping team names and compact numeric columns.
- Match the current row by trimmed, case-insensitive team name and never highlight a fallback row.

## Files And Modules Touched

- `apps/app/src/lib/adapters/legacyPublicTeamsDb.ts`
- `apps/app/src/pages/PublicTeamDetail.tsx`
- `apps/app/src/pages/PublicTeamDetail.test.tsx`
- Required run artifacts in this directory.

## Data/State Impacts

- Read-only. No persistence or schema changes.
- Disabled standings cause no public-games request.
- Incomplete pagination already fails closed in #4690 and is rendered as unavailable rather than partial standings.
- Route cleanup prevents stale profile or standings results from rendering.

## Security/Permissions Impacts

- Anonymous data continues exclusively through the public profile and public games projection.
- No authenticated game, roster, schedule, or contact loader is introduced.
- The existing sanitized league URL is opened with `target="_blank"` and `rel="noreferrer"`.

## Failure Modes And Mitigations

- Projection or computation failure preserves identity content and shows a standings-specific unavailable state.
- No qualifying games shows an explicit empty state.
- Long names wrap inside a fixed table instead of widening the page.
- No exact current-team match yields no fabricated highlight.
- Native behavior drift remains covered by existing engine tests; this change only verifies exact input/config handoff.
