# Requirements

## Problem Statement

The modern public team profile must render a trustworthy, mobile-first standings snapshot from the sanitized public inputs delivered by #4690, without exposing rosters, private schedules, contacts, assignments, or member data.

## User Segments Impacted

- Parents and fans need standings without authentication and clear fallback guidance.
- Coaches need a shareable game-day destination that reduces repeated ranking questions.
- Team administrators need configured ranking rules and the league link honored publicly.
- Sports managers need reliable public output with secondary-data failures isolated from the profile.

## Acceptance Criteria

1. A signed-out visitor sees a standings section on `/teams/:teamId/public`.
2. Enabled standings with qualifying completed public games render rank, team, record, and the configured points or win-percentage metric.
3. The normalized ranking mode, scoring, goal-differential cap, and tiebreakers reach the native standings engine unchanged.
4. The current team is visibly highlighted and programmatically marked, including case and surrounding-whitespace differences.
5. Disabled, empty, projection-failure, and computation-failure states preserve the public profile and explain the local state.
6. A valid configured `leagueUrl` remains available in populated and fallback states.
7. At 320 CSS pixels, long team names remain readable without page-level horizontal clipping.
8. Only sanitized completed public games affect the result; no private collections or authenticated game loaders are used.
9. Authenticated `TeamDetail` and native ranking behavior remain unchanged.

## Non-Goals

- Recent results or score-history cards.
- Standings editing controls.
- Native standings algorithm changes.
- New Firestore queries, writes, rules, indexes, or publishing workflows.

## Edge Cases

- No qualifying games, incomplete pagination, or computation failure.
- No current-team row match.
- Long names, missing numeric values, and tied/non-numeric rank display.
- Route navigation while profile or standings requests are pending.
- Missing or rejected league URL.

## Open Questions

- Team-scoped projections omit games played only between other opponents. The issue explicitly requires the #4690 normalized inputs and existing native computation, so this run preserves that contract. A complete league-wide table would require a separately scoped, server-authoritative group projection.
- A standings-specific retry action and large-table collapsing remain out of scope for this slice.
