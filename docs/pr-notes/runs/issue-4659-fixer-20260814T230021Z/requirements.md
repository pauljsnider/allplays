# Requirements

## Problem Statement

The modern anonymous team profile exposes only identity and general location even though existing public callables already provide sanitized standings configuration, league metadata, and public game results. Parents and fans need those read-only results without widening the public-data boundary.

## User Segments Impacted

- Parents and fans need trustworthy standings and final scores without authentication.
- Coaches need one shareable game-day URL.
- Admins retain control through the existing public-team and standings settings.
- Team members retain protection for rosters, contacts, assignments, and private schedules.

## Acceptance Criteria

1. A signed-out visitor can view standings and recent final results for a valid public team.
2. Enabled standings use the configured ranking mode, points, differential cap, and tiebreakers.
3. The current team row is visually and accessibly identified.
4. The standings table is horizontally scrollable on narrow screens without page-level overflow.
5. Recent results are newest-first, limited to five, and include opponent, date, team-perspective final score, and Win/Loss/Tie.
6. Scheduled, live, cancelled, private, practice, deleted, and score-incomplete games do not appear or affect standings.
7. Data comes only from the existing anonymous, rate-limited public callables.
8. The typed client model retains only required allow-listed metadata and normalized result inputs.
9. Missing computable rows produce a useful empty state and a league link when configured.
10. Missing or non-public teams preserve the existing not-found behavior.
11. Projection failure preserves the public identity card and presents a retryable results error.

## Non-Goals

- New APIs, Firestore reads, score entry, publishing, or configuration editing.
- Public roster, contacts, assignments, player statistics, private schedules, live scoreboard, or upcoming schedule.
- Changes to native ranking semantics or authenticated team-detail workflows.

## Edge Cases

- Away games, ties, zero scores, custom points, win-percentage ranking, and capped differential.
- More final games than the display cap.
- Completed games that do not count toward the season record.
- Invalid league URLs and truncated public projections.
- Route changes while profile or result requests are pending.

## Decisions

- Display at most five recent results.
- Exclude `countsTowardSeasonRecord === false` from standings but allow it in recent results.
- Preserve team identity when the auxiliary results request fails.
