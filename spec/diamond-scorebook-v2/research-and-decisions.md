# Research and Product Decisions

Research was refreshed on 2026-09-05. Product documentation describes behavior,
not an implementation contract, so competitor claims are treated as directional
benchmarks. Governing-body rules also vary by sanction, age, tournament, and
local adoption; no profile is described as universally authoritative.

## GameChanger benchmark

GameChanger's current documentation establishes a high baseline:

- [Scorekeeping and Stats](https://help.gc.com/hc/en-us/articles/360039839812-Scorekeeping-and-Stats)
  describes play-by-play scoring, scorer handoff, season batting/pitching/fielding
  views, spray charts, and more than 150 generated statistics.
- [Basic Scorekeeping](https://help.gc.com/hc/en-us/articles/30710418133005-Basic-Scorekeeping)
  and the
  [Diamond Stat/Scorekeeping FAQ](https://help.gc.com/hc/en-us/articles/33273356420749-Diamond-Stat-Scorekeeping-FAQs)
  show a progressively disclosed field workflow. They also document that
  scorekeepers may omit details, but the associated statistics can then be
  inaccurate.
- [Starting Lineups](https://help.gc.com/hc/en-us/articles/360033202792-Starting-Lineups),
  [Quick Lineups](https://help.gc.com/hc/en-us/articles/360030865612-Quick-Lineups),
  and
  [lineup sharing](https://help.gc.com/hc/en-us/articles/25102463562509-Share-Starting-Lineups-for-Baseball-Softball)
  cover pregame setup, opponent placeholders, DH/DP/FLEX, printable cards, and
  QR transfer.
- [Automatic Video Clips](https://help.gc.com/hc/en-us/articles/21334712734733-Automatic-Video-Clips-FAQs)
  ties clips to real-time scoring and documents timing and reassignment limits.
- [Recap Stories](https://help.gc.com/hc/en-us/articles/360045621491-Game-Recap-Stories),
  [Post-Game Insights](https://help.gc.com/hc/en-us/articles/41889263070861-Post-Game-Insights),
  and
  [Lineup Recommendations](https://help.gc.com/hc/en-us/articles/42067886646157-Lineup-Recommendations-BETA)
  demonstrate generated narrative, data-driven observations, and optimization.
- The documented audio feature is fan-facing text-to-speech
  [Plays Announcer](https://help.gc.com/hc/en-us/articles/4415329088909-Listening-Live-With-the-Plays-Announcer).
  No official documentation reviewed for this spec described scorer voice notes
  or voice-command play entry. That is an absence in the reviewed public
  documentation, not proof that no undocumented or later feature exists.

AllPlays should not claim parity in native polish, streaming, automated clips,
spray charts, adoption, or the breadth of an established 150-plus-stat catalog.
The differentiated promise is narrower and verifiable: every displayed number
has a source revision, source plays, rules/catalog versions, and an explicit
capture-completeness status; one correction rebuilds every dependent read model;
and the scorebook connects to the team's existing schedule, RSVP, communication,
practice, registration, report, and Private AI workflows.

## Open-source and data-model review

We reviewed public source and format documentation for concepts, not code reuse:

- [Retrosheet event files](https://www.retrosheet.org/eventfile.htm) model a game
  as chronological records and keep the batter result, runner advances, count,
  pitch sequence, and play notation together.
- [Chadwick `cwevent`](https://github.com/chadwickbureau/chadwick/blob/master/doc/cwevent.rst)
  derives before/after situation, runner origin, pitcher responsibility, fielding
  credits, and stat flags from those events. Its documentation explicitly
  preserves unknown count data instead of silently turning unknown into 0-0 and
  leaves earned-run judgments explicit when the source lacks enough information.
- [`retrosheetshow`](https://github.com/tgerke/retrosheetshow) independently
  parses typed plays, replays game state, and validates its output against
  Chadwick. This reinforces replay-from-events as a useful oracle boundary.
- [Chadwick](https://github.com/chadwickbureau/chadwick) is GPL-licensed. Diamond
  v2 does not copy or link its implementation; deterministic fixtures may compare
  independently produced outcomes against published formats or exported data.

These sources led directly to five architecture choices:

1. A plate appearance and every involved runner move are one atomic command.
2. Canonical events retain both before and after state plus a hash chain.
3. Runner origin and responsible pitcher survive substitutions and courtesy
   runners.
4. Fielding and official-scorer judgments are captured as evidence, never guessed.
5. Missing pitch, fielding, situational, or sensor data remains partial or
   not-collected instead of becoming a plausible-looking zero.

## Rules sources and limits

Rules-profile design was checked against the
[2026 Official Baseball Rules](https://www.mlb.com/glossary/rules), the
[2026 USA Softball rule book](https://www.usasoftball.com/wp-content/uploads/sites/120/2026/01/1-12-2026-Rule-Book.pdf),
[2026 Little League changes](https://www.littleleague.org/playing-rules/rule-changes/),
and the [NFHS baseball rules portal](https://www.nfhs.org/sports/baseball/rules).
Those sources confirm that substitutions, re-entry, courtesy runners, DP/FLEX,
dropped third strikes, automatic runners, run-ahead endings, and scoring
responsibility cannot safely be collapsed into one generic "baseball" switch.

Accordingly:

- each game pins an immutable profile ID/version and stat-visibility snapshot;
- Baseball and Fastpitch remain distinct sports even when controls look similar;
- local youth settings require a new immutable profile version, never mutation
  of an active game's rules;
- the scorer records subjective or umpire-controlled rulings explicitly;
- a wall-clock timeout alone never silently ends a game because delays, inning
  completion clauses, tournament overrides, and umpire declarations differ;
- sensor metrics are absent unless measured, and AI never adjudicates a rule.

## Decision trace

| Research signal | Diamond v2 implementation |
| --- | --- |
| Complex plays affect multiple runners and credits | Typed atomic play commands with independent runner destinations |
| Historical corrections can alter many totals | Append-only void/supersede events and full deterministic reprojection |
| Optional capture can make derived stats misleading | Per-family `complete`, `partial`, and `not_collected` coverage |
| Scorer handoff can fork or overwrite a stream | One revision-checked scorer lease and explicit handoff/recovery |
| Stats depend on rule and scorer judgment | Pinned rule/catalog versions and cited scoring decisions |
| Real-time score events drive clips and alerts | Revision-deduplicated outbox after authoritative projection |
| Generated prose can become stale after edits | Source revision/checkpoint citations and correction-driven staleness |
| Voice recognition and models can be wrong | Editable proposal plus human confirmation; no raw audio retention |
| Youth and fastpitch participation rules vary | Separate versioned profiles; unsupported local variants remain classic |

## Deferred parity, stated plainly

The first dark merge does not promise GameChanger-equivalent streaming,
automatic at-bat detection, sensor integrations, spray charts, QR lineup exchange,
or lineup optimization. Shared-schedule mirrors also remain on the classic
tracker until one server-owned canonical ledger can safely project to both teams.
These are activation boundaries, not hidden fallbacks: unsupported data is labeled
and unsupported games are never partially claimed by Diamond v2.
