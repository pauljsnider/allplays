# Stat and Completeness Catalog

## Capture status

Every game and stat family carries one of:

- `complete`: all required source events and scorer judgments were captured.
- `partial`: known values may be displayed with coverage, but absence, official
  ranking, and qualification cannot be inferred.
- `not_collected`: the selected mode or available instrumentation did not collect
  the required source data.

Projection and UI code must never turn `partial` or `not_collected` into zero.

## Traditional statistics

| Family | Raw counters | Derived values |
|---|---|---|
| Batting | G, GS, PA, AB, R, H, 1B, 2B, 3B, HR, TB, RBI, BB, IBB, HBP, SO, SF, SH, ROE, FC, GIDP | AVG, OBP, SLG, OPS, BB%, K% |
| Baserunning | SB, CS, pickoffs, recorded advances, recorded baserunning outs | SB% |
| Pitching | APP, GS, W, L, SV, BF, outs, H, R, ER, BB, IBB, HBP, SO, HR, WP, balk/illegal pitch, inherited/scored runners, pitches/strikes | IP display, ERA, WHIP, K/BB, strike%, first-pitch-strike% |
| Fielding | defensive outs, PO, A, E, DP/TP participation, PB | FPCT and chances |
| Team/game | inning lines, R, H, E, LOB, RISP opportunities/hits, two-out runs, first-pitch-strike opportunities/results, and two-strike PA/hits | No team rate fields in catalog v1; denominator counters remain available for an additive version |

Derived formulas use unrounded raw counters and round only for display. Zero
denominators display an em dash, never `0.000`. Leaderboards require explicit
qualification rules and complete coverage denominators.

## Visibility and read models

- The activation-pinned stat snapshot is the visibility authority. The
  projector embeds `diamondPublicTeamStats` in the server-owned game projection
  with only the pinned `publicTeamStatIds`; values, observed values, and
  per-stat coverage are all filtered by that same allowlist. Authorized raw-game
  readers validate that nested envelope locally. Anonymous fan readers receive
  it only through the public game callable's strict serializer; raw game reads
  are not opened anonymously.
- Every Diamond v2 player or full-team stat document lives under its immutable
  generation, not in the legacy tracker collections:
  `diamondStatGenerations/{instanceId}/publicPlayerStats/{playerId}`,
  `diamondStatGenerations/{instanceId}/privatePlayerStats/{playerId}`, and
  `diamondStatGenerations/{instanceId}/teamStats/team`. The public player
  envelope repeats the owning team/game/player IDs and full projection head;
  readers build the path only from the current authoritative game head and
  reject the collection as a whole on any missing, stale, malformed, duplicate,
  or unexpectedly expanded document. Legacy `aggregatedStats`,
  `privatePlayerStats`, and `teamStats` remain exclusively on the classic
  tracker path and are neither overwritten nor used as a Diamond fallback.
- Public player reads accept at most 50 exact-generation documents and fail the
  entire read closed on overflow; they never truncate or turn overflow into an
  empty result. The initial rollout validates 25-player rosters. Supporting
  more than 50 distinct managed players requires raising this reader bound with
  corresponding load and browser evidence.
- The public team subset carries the exact scorebook instance, projection
  generation, source revision, checkpoint hash, stat-config snapshot hash, and
  projection hash. Game and season readers reject the whole nested document if
  any identity is missing, stale, malformed, or if an undeclared stat key is
  present. A rejected document is pending/partial evidence, not a zero.
- `getPublicDiamondGame` exposes that subset only inside an indivisible
  `diamondStats` response envelope. A valid envelope has exactly
  `schemaVersion: 1`, `trackingEngine: "diamond-v2"`, `status: "complete"`,
  `complete: true`, `instanceId`, `sourceRevision`, `checkpointHash`,
  `statConfigSnapshotHash`, `projectionHash`, and `publicTeamStats`. If the
  current head or sanitized subset cannot be proven, the envelope contains only
  the schema/engine plus `status: "partial"` and `complete: false`; identity and
  stat data are omitted so failure can never masquerade as confirmed absence.
- Full team counters remain in the generation-scoped manager-only
  `teamStats/team` projection and are available to authorized internal reports
  only through the bounded manager-stats callable. The callable rechecks the
  current projection head and manager access before and after its exact bulk
  read. A delegated single-game scorekeeper does not gain manager-stat access;
  scorer history remains a separate, bounded private-summary API. Public/fan
  readers never query or fall back to the internal stat collection.
- Game reports and season team totals consume the nested public subset from the
  authoritative game records they already loaded. This adds no per-game stat
  document reads. CSV output labels every row `public` or `manager-internal`
  and uses the same visibility suffix in its filename; the two scopes cannot
  be mixed in one export. In a season containing both legacy and Diamond games,
  the explicitly labeled Diamond team total covers Diamond games only.

## Immutable orientation

Activation pins `orientationSnapshot` on the canonical scorebook root with
schema version, managed/opponent sides, managed/opponent IDs, canonical
home/away IDs, and canonical team/opponent/home/away names. The managed-side ID
is always materialized as the owning team ID; an unlinked opponent uses `null`
on the opponent side. Projection validates the exact snapshot and binds its hash
to the projection lease, run, key, and completion marker. Mutable schedule
fields such as `isHome`, `teamSide`, `homeAway`, team IDs, or display names never
select a stat side or rename a public Diamond projection after activation. A
missing, malformed, mismatched, or mid-run changed snapshot fails closed.

## Capture modes

- Quick mode requires plate-appearance result, responsible batter/pitcher,
  explicit runner destinations/outs, lineup progression, and score/outs. Core
  batting, baserunning, and pitching outcomes can be complete; pitch, fielding,
  and detailed situational families may be partial or not collected.
- Full mode records every pitch, count transition, batted-ball location when
  entered, fielding chain, scoring judgment, substitution, and rule action. It
  can produce the complete catalog listed above; advancement-by-cause rates,
  defensive innings, and team situational rates are not catalog v1 fields.
- Smart prompts appear only when an omitted judgment changes a selected stat;
  dismissing the prompt records the affected family as partial.

## Instrumented statistics

Velocity, spin, movement, release metrics, exit velocity, launch angle, hang
time, route/reaction data, biomechanics, framing, catch probability, WAR, wOBA,
and park/league-adjusted values require external measurement or model inputs.
They remain `not_collected` unless a future version records provenance and model
version explicitly.
