# Requirements

## Problem Statement

The modern public team profile renders only public identity data even though #4690 now exposes sanitized standings configuration, league URL, and completed public game inputs. Anonymous visitors therefore cannot see computed standings or a useful standings fallback.

## User Segments Impacted

- Parents and public visitors need a trustworthy standings snapshot without authentication.
- Coaches need the current team clearly identified and values consistent with league rules.
- Team administrators need configured standings and league links reflected publicly.
- Program managers need reliable mobile presentation without private-data exposure.

## Acceptance Criteria

1. Anonymous visitors see a semantic standings table when standings are enabled and qualifying completed public games exist.
2. Rows come from the existing native engine using the normalized ranking mode, scoring, goal-differential cap, and ordered tiebreakers unchanged.
3. The current team is visibly highlighted and marked with `aria-current="true"`.
4. Points mode renders points; win-percentage mode renders a formatted percentage.
5. Disabled, empty, and failed standings loads preserve the public profile and show a useful local state.
6. A configured sanitized `leagueUrl` is available in populated and fallback states.
7. The table fits a narrow card without page-level horizontal clipping, including long team names.
8. No private roster, contact, member, schedule, or administrative data is loaded.
9. Existing authenticated standings and native ranking behavior remain unchanged.

## Non-Goals

- Recent results or score cards.
- Authenticated `TeamDetail` changes.
- Native standings behavior changes.
- Backend, schema, rule, or index changes.

## Edge Cases

- Enabled standings with no qualifying games or an empty computation result.
- Projection failure after profile success.
- Disabled standings with and without a league URL.
- No exact current-team row match.
- Long team names and route changes while requests are pending.
- Invalid league URLs, which remain filtered by the #4690 normalization boundary.

## Open Questions Resolved

- Current-team matching uses normalized team name because native rows have no canonical team ID.
- Disabled, empty, and projection-failure conditions all count as unavailable and receive specific messages.
- The table renders all projected rows, so a current team below an arbitrary collapse limit remains visible.
- This slice uses the complete sanitized team-scoped projection and does not claim broader league completeness.
