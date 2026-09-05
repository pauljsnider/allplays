# Validation and Rollout

## Automated gates

- Pure reducer fixtures cover Baseball and Fastpitch rules, complex runner
  movement, DP/FLEX, re-entry, courtesy runners, pitcher responsibility, third
  outs, tiebreakers, mercy rules, suspensions, walkoffs, corrections, and replay
  hash equality.
- Stat oracles cover raw totals, formulas, zero denominators, outs-based innings,
  qualifications, ties, rounding, legacy aggregate-only games, and mixed-season
  completeness.
- Command tests cover duplicate and conflicting idempotency keys, stale expected
  revisions, two-device races, lease handoff, lost/ambiguous responses, ordered
  offline replay, finalization races, and correction/projector retries.
- Firestore emulator tests cover public, parent, member, delegated scorer,
  manager, admin, cross-team, disabled-policy, inactive-team, old-client, unknown
  engine, malformed command, and private-note access.
- UI tests cover both team-creation surfaces, the shared scorer, legacy launch
  resolution, live/replay/overlay, reports, stats, leaderboards, exports, clips,
  shared games, chat/reactions, notifications, and deep links.
- Voice tests prove no audio persistence, transcript privacy, cancellation,
  low-confidence clarification, no unconfirmed mutation, and ordinary-control
  fallback during speech or AI failure.
- Load fixtures cover 1,500 events, a 40-game season, 25-player rosters, replay
  pagination, resume from a bounded snapshot, and no N+1 game reads.
- Compatibility tests prove disabled policy and every legacy/non-diamond game
  retain existing routes, writes, reports, notifications, and public pages.

## Required local preflight

Run focused Diamond tests before broader repository checks, followed by root
unit CI, Functions notification/auth/team/security suites, app typecheck/lint/test,
Firestore rules tests, app build, focused and full Playwright smoke, cache-bust
guard when legacy shared modules change, iOS simulator build, Android debug
build, and physical-device offline/background validation.

## Activation gates

1. Deploy with policy disabled and prove no new route, UI, write, or notification.
2. Enable internal practice games only.
3. Enable allowlisted teams for new, untracked games.
4. Double-score pilot games against an independent paper or established
   scorebook and investigate every mismatch.
5. Require 100% replay/checkpoint integrity, zero unexplained stat mismatches,
   at least 99.9% accepted-command durability, no unresolved projection lag, and
   zero privacy/security defects.
6. Accumulate at least 200 completed games and 14 stable days per sport.
7. Expand new-game activation through 1%, 10%, 50%, and 100% cohorts.

Rollback disables activation, then new commands. It never removes the canonical
ledger or disables viewing, replay, correction, projection, or cleanup for an
already activated game.
