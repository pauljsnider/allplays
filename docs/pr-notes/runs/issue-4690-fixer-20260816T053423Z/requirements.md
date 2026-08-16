# Requirements Role

## Problem Statement

The server already publishes sanitized `leagueUrl`, `standingsConfig`, and public game projections, but the typed public-team boundary drops those fields and has no standings-ready game model. Consumers cannot calculate public standings without bypassing the typed service or duplicating security-sensitive normalization.

## User Segments Impacted

- Parents and public viewers need trustworthy standings derived only from completed public games.
- Coaches need correct home/away orientation, scores, dates, and tournament grouping.
- Team administrators need configured league and standings values reflected without administrative fields.
- Program managers need consistent league and tournament inputs with public-data segregation.

## Acceptance Criteria

1. `getPublicTeamDetail` preserves existing identity fields and adds a sanitized HTTP(S) `leagueUrl` plus a bounded `standingsConfig`.
2. `standingsConfig` contains only `enabled`, `rankingMode`, `points.win/tie/loss`, `maxGoalDiff`, `tiebreakers`, `twoTeamTiebreakers`, and `multiTeamTiebreakers`.
3. Owner, contact, permission, note, and unknown nested fields never cross the typed boundary.
4. The adapter calls the existing anonymous `getPublicTeamGamesProjection` callable with no Firestore or authenticated-game fallback.
5. Normalized inputs contain stable identity, home/away teams, oriented scores, completed status, a valid date, and allow-listed tournament division/pool metadata.
6. Only completed non-practice projections with finite non-negative scores, valid dates, and nonempty team names are returned.
7. Scheduled, live, cancelled, postponed, deleted, private, practice, mismatched-team, and non-public-team projections are excluded or fail closed.
8. Home and away projections orient the public team, opponent, and scores correctly.
9. Missing/invalid dates, names, or scores are omitted rather than fabricated.
10. Private, inactive, archived, disabled, missing, or mismatched team responses produce no standings inputs and never fall back to canonical games.
11. Tournament metadata preserves only `divisionName`, `division`, and `poolName`.
12. Focused tests cover configured values, home/away normalization, exclusions, pagination integrity, and private-field stripping.
13. Existing authenticated and native standings behavior remains unchanged.

## Non-Goals

- Rendering standings or recent results.
- Changing native ranking, scoring, differential, or tiebreaker behavior.
- Adding Firestore queries, indexes, public rules, or publishing workflows.
- Exposing roster, player stats, summaries, media, location, assignments, RSVP, or coaching data.
- Inferring organization or league membership across teams.

## Edge Cases

- Away losses must not reverse names or scores.
- Zero-zero completed ties are valid.
- Numeric strings, missing scores, negative values, `NaN`, and infinity are invalid.
- Scheduled/live games with provisional scores remain excluded.
- Completed practices and private/deleted mocked projections remain excluded.
- Partial tournament metadata retains only valid public fields.
- Malformed config is bounded without silently enabling standings.
- Invalid, credential-bearing, or non-HTTP(S) league URLs become `null`.
- Truncated pagination without a fresh cursor fails instead of returning partial standings.

## Open Questions

- Malformed games are silently omitted; the public consumer does not receive diagnostics.
- Numeric strings remain invalid because the server serializer already emits numbers.
- Callable chronological order is preserved.
