# Validation and Rollout

The lists below are acceptance requirements, not a claim that every item has
already produced evidence. The draft PR remains draft until the exact head has
an attached preflight receipt. Physical-device results, pilot game counts, and
stable-day evidence are activation gates and cannot be inferred from unit tests.

## Policy contract implemented on this branch

| Mode       | New-game activation                                                  | Existing Diamond scoring                                                                                 |
| ---------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `disabled` | Denied                                                               | Ordinary scoring denied; read/replay/correction/manager cancellation/projection/cleanup remain available |
| `internal` | Exact bounded `teamIds` allowlist only                               | Exact allowlist only                                                                                     |
| `pilot`    | Exact bounded `teamIds` allowlist only                               | Exact allowlist only                                                                                     |
| `enabled`  | Explicit allowlist, or deterministic 1/10/50/100 percent game cohort | Allowed when the compatible-build gate passes                                                            |

`rolloutPercent` is required only in `enabled` mode and must be the integer 1,
10, 50, or 100. Missing, string, unsupported, or mode-incompatible values make
the whole policy malformed and disabled. The cohort bucket is the stable 1–100
result of the versioned `diamond-v2-rollout` hash over the exact team and game
IDs. Expanding 1 → 10 → 50 → 100 is monotonic for the same IDs. A percentage is
a deterministic bucket boundary, not a promise that a small sample contains an
exact percentage of games. Activation records the policy revision, mode,
percentage, bucket, and allowlist decision in the private scorebook audit state.

The merge itself does not write the production policy. There is currently no
end-user rollout-policy editor; an authorized operator must apply and verify the
policy document through the controlled Firebase administration path. The global
policy must remain missing or `disabled` for the dark merge. `minimumAppBuild`
must remain 0 until hosted generation 2 and separately released native builds
have been verified; native compatibility uses the installed package build, not
the hosted Vite value.

## Automated gates

- Pure reducer fixtures cover Baseball and Fastpitch rules, complex runner
  movement, DP/FLEX, re-entry, courtesy runners, pitcher responsibility, third
  outs, tiebreakers, mercy rules, suspensions, walkoffs, corrections, and replay
  hash equality.
- A checked rule-behavior inventory classifies every profile field as identity,
  stat-only, deterministic, explicit-decision, partially enforced, or advisory.
  Tests reject unsupported batting roles, incomplete or late DP/FLEX setup,
  an omitted/wrong/late tiebreaker runner, premature finalization, run-cap play
  continuation, unknown decision codes, and duplicate game-ending decisions.
- Ending fixtures cover regulation, walkoff, run-ahead, run-cap, time-limit,
  weather, and both awarded-side forfeit decisions. They prove the event ID is
  retained in state, subsequent play is blocked, and correction re-finalization
  preserves or re-establishes a valid ending reason without using wall-clock
  inference.
- Cancellation fixtures cover ready, active, and suspended games; explicit
  confirmation and bounded reason validation; server-verified manager authority
  on first execution and idempotent retries; full-ledger/bounded-checkpoint event
  parity; terminal lifecycle behavior; correction rejection; replay equality;
  and hash failure after payload tampering.
- Stat oracles cover raw totals, formulas, zero denominators, outs-based innings,
  qualifications, ties, rounding, legacy aggregate-only games, and mixed-season
  completeness.
- Command tests cover duplicate and conflicting idempotency keys, stale expected
  revisions, two-device races, lease handoff, lost/ambiguous responses, ordered
  offline replay, finalization races, and correction/projector retries.
- Effect and notification tests bind every deduplication, receipt, provider, and
  inbox delivery identity to the immutable scorebook instance. They prove one
  same-generation retry, reject the same identity with different content, and
  preserve a distinct retained inbox row when the same team/game path and
  revision are recreated under a new instance without logging resource IDs.
- Firestore emulator tests cover public, parent, member, delegated scorer,
  manager, admin, cross-team, disabled-policy, inactive-team, old-client, unknown
  engine, malformed command, and private-note access.
- UI tests cover both team-creation surfaces, the shared scorer, legacy launch
  resolution, live/replay/overlay, reports, stats, leaderboards, exports, clips,
  shared games, chat/reactions, notifications, and deep links.
- Voice tests prove no audio persistence, transcript privacy, cancellation,
  low-confidence clarification, no unconfirmed mutation, and ordinary-control
  fallback during speech or AI failure.
- Load fixtures cover more than 2,000 private command summaries, a 40-game
  season, 25-player rosters, replay pagination, resume from a bounded snapshot,
  and no N+1 game reads. The scorer loads the current 200-event suffix first,
  progressively joins exact adjacent older blocks, preserves the verified suffix
  if an older read fails, applies newer corrections to newly loaded older targets,
  and never labels a suffix as complete history unless sequence 1 is present.
- Compatibility tests prove disabled policy and every legacy/non-diamond game
  retain existing routes, writes, reports, notifications, and public pages.

Rule-profile declarations marked advisory or partially enforced are not general
availability claims. Pilot allowlists must exclude leagues that require strict
continuous-batting, look-back, leaving-early, unrestricted DP/FLEX participation,
or complete substitution/courtesy-runner eligibility until typed commands and
deterministic reducer coverage exist for those rules.

## Required local preflight

Run `npm run test:diamond:ci` first. It rebuilds the generated server engine,
fails on source/generated drift, and runs the focused root, Functions, and app
Diamond suites plus passive baseball compatibility regressions. Then run broader root
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

The repository gate proves policy parsing, deterministic bucket parity between
server and legacy routing, allowlist behavior, Firestore policy shape, and
activation denial. It does not produce the 200-game, 14-day, durability,
privacy, projection-lag, or double-score evidence; those remain explicit
operator sign-offs before each policy transition.

Rollback disables activation, then new ordinary scoring commands. It never
removes the canonical ledger or disables viewing, replay, correction,
manager-confirmed cancellation, projection, or cleanup for an already activated
game.

Recursive game cleanup removes the private Diamond notification receipts with
the scorebook. Already-delivered user inbox rows remain subject to the existing
inbox retention policy; their hashed delivery document IDs are scorebook-instance
scoped, so a recreated game cannot overwrite a prior generation's row.
