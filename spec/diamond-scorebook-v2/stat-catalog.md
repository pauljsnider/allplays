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
| Baserunning | SB, CS, pickoffs, advances and outs by cause | SB%, advancement rates |
| Pitching | APP, GS, W, L, SV, BF, outs, H, R, ER, BB, IBB, HBP, SO, HR, WP, balk/illegal pitch, inherited/scored runners, pitches/strikes | IP display, ERA, WHIP, K/BB, strike%, first-pitch-strike% |
| Fielding | defensive innings, PO, A, E, DP/TP participation, PB | FPCT and chances |
| Team/game | inning lines, LOB, RISP opportunities/results, two-out runs, first-pitch and two-strike outcomes | situational rates with denominators |

Derived formulas use unrounded raw counters and round only for display. Zero
denominators display an em dash, never `0.000`. Leaderboards require explicit
qualification rules and complete coverage denominators.

## Capture modes

- Quick mode requires plate-appearance result, responsible batter/pitcher,
  explicit runner destinations/outs, lineup progression, and score/outs. Core
  batting, baserunning, and pitching outcomes can be complete; pitch, fielding,
  and detailed situational families may be partial or not collected.
- Full mode records every pitch, count transition, batted-ball location when
  entered, fielding chain, scoring judgment, substitution, and rule action. It
  can produce the complete traditional catalog.
- Smart prompts appear only when an omitted judgment changes a selected stat;
  dismissing the prompt records the affected family as partial.

## Instrumented statistics

Velocity, spin, movement, release metrics, exit velocity, launch angle, hang
time, route/reaction data, biomechanics, framing, catch probability, WAR, wOBA,
and park/league-adjusted values require external measurement or model inputs.
They remain `not_collected` unless a future version records provenance and model
version explicitly.

