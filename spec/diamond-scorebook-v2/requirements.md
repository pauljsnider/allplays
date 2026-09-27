# Requirements

## Eligibility and compatibility

- Baseball and Softball team setup in legacy web and the React app use the same
  versioned rules-profile catalog.
- A manager may configure Diamond v2 without invalidating the existing generic
  stat config. Configuration failure leaves the team usable with legacy tools.
- Activation requires all three gates: a valid global policy decision, explicit
  team opt-in, and a server-created per-game activation document. `internal`
  and `pilot` admit only exact team IDs in the bounded allowlist. `enabled`
  additionally requires an exact `rolloutPercent` of 1, 10, 50, or 100 and
  admits a new game only when its stable team/game cohort falls within that
  percentage or its team is explicitly allowlisted.
- New setup and activation entry points require two independent launch layers:
  the client runtime value `diamondScorebookUiEnabled === true` and a successful
  server policy/team/game eligibility decision. A missing, false, malformed, or
  unreadable client value exposes no new Diamond setup or activation controls
  and does not request activation access. This client gate never hides read,
  replay, correction, cancellation, or recovery routes for a game already owned
  by `trackingEngine: "diamond-v2"`.
- Only newly scheduled Baseball or Softball games with no meaningful legacy
  score, events, aggregates, live state, or completed status may activate.
- The first accepted Diamond command permanently locks the game to
  `trackingEngine: "diamond-v2"`. Unknown nonempty engine values fail closed.
- Legacy games, non-diamond sports, and old links retain their current routes and
  persistence behavior.
- Percentage cohorts gate only new activation. Reducing a percentage does not
  reassign a game that Diamond already owns; normal scoring still obeys the
  global policy and minimum compatible build, while read, replay, correction,
  projection, and cleanup remain available under rollback.

## Scoring

- The scorer provides Quick and Full capture modes. Quick mode asks only for the
  information needed for score, outs, bases, lineup progression, and selected
  core stats. Full mode adds every pitch, fielding chains, scoring judgments,
  substitutions, and rule-specific actions.
- Both modes use one canonical command API and deterministic reducer.
- Commands validate state-before and state-after invariants, actor authority,
  game lifecycle, active scorer lease, selected rules profile, expected
  revision, payload limits, and command idempotency.
- A reconnecting client reconciles queued commands against authoritative state.
  It never assumes an ambiguous response failed and never forks the game stream.
- Scorer handoff is explicit. Only one lease may accept normal scoring commands;
  managers may recover an expired lease through the server.
- Finalization requires an authoritative, gap-free replay and explicit scorer
  confirmation. A game is eligible only after regulation completion, a walkoff,
  a configured run-ahead condition, or a typed time-limit, weather, or forfeit
  decision. Corrections remain possible for authorized staff after final and
  must re-establish an eligible finalization reason before re-finalizing.
- Cancellation is separate from finalization. A server-verified current manager
  may explicitly confirm a bounded reason while a game is ready, active, or
  suspended. The resulting `cancelled` lifecycle is terminal/read-only, retains
  its immutable actor/event audit trail, and cannot be corrected into a result.

## Rules

- Rules profiles are immutable and versioned. A game pins its profile and
  catalog versions at activation.
- Baseball profiles cover OBR-style, NFHS-style, and configurable youth rules.
- The deterministic reducer enforces scheduled-inning finalization, configured
  run-ahead thresholds, dropped-third-strike eligibility, profile-allowed
  DH/EH/EP/DP batting-role admission, a bounded linked-slot DP/FLEX exchange,
  and tiebreaker inning/base/previous-batter identity.
- Inning run limits and time limits require typed scorer/umpire decisions. The
  reducer validates the pinned profile threshold or availability and records
  the exact decision event; it never infers elapsed time from a device or server
  clock. Weather and awarded-side forfeit endings use the same typed audit path.
- DP/FLEX participation beyond the supported linked-slot exchange, complete
  substitute eligibility, courtesy-runner participation history, and automatic
  `ball_and_advance` runner movement are only partially enforced. Continuous
  batting, look-back, and leaving-early remain advisory profile declarations.
  They must not be represented as fully supported scoring behavior or enabled
  for a pilot that depends on deterministic enforcement.
- Scheduled innings, time limits, inning run limits, mercy rules, tiebreakers,
  continuous batting, free substitution, DH/EH/EP, and ERA inning basis are
  explicit versioned parameters rather than sport-wide constants; a parameter's
  presence does not imply behavior beyond the enforcement boundary above.

## Read surfaces

- A bounded public projection provides current score, inning/half, count, outs,
  occupied bases, lineup-safe play descriptions, and a monotonic revision.
- Replay is cursor-paginated and reconstructs state from canonical public events;
  it never infers the current state from a limited subscription window.
- Existing game, player, team, season, leaderboard, export, clip, notification,
  shared-game, chat, and reaction surfaces consume server projections and declare
  their source revision and completeness.
- A projection failure retains the last complete state and shows a retryable
  unavailable/partial status. Only a complete empty result proves absence.

## Live engagement

- Classic games retain their existing direct `liveChat` and `liveReactions`
  creates. Diamond v2 games deny those direct creates and accept them only
  through server-authoritative callables. Diamond interactions are stored under
  `diamondLiveGenerations/{instanceId}/chat` and `/reactions`; classic
  collections remain unchanged, while every v2 viewer shares the same exact
  generation path.
- Activation starts a fresh generation-scoped Diamond conversation. Existing
  flat classic messages and reactions are retained but are not copied into or
  exposed by the v2 thread; this avoids making an older game's interactions
  readable after a game ID is deleted and reused.
- Each Diamond request carries a secure UUID v4, the exact public scorebook
  instance, and an explicit `live` viewer mode. Replay and overlay modes never
  expose a write path. The server re-verifies an enabled Auth record, the staged
  verified-email policy, current public/delegated access, game/root instance
  equality, and authoritative lifecycle before writing.
- Configured or ready games require an explicit valid team/game timezone and an
  exact server-side game-day match. Active and suspended games remain live;
  final, correction, cancelled, deleted, non-game, missing-timezone, and
  malformed states fail closed.
- Chat identity is derived from current Auth/profile records; clients cannot
  submit sender IDs, names, or photos. A transaction atomically writes the
  generation-scoped interaction, a content-bound receipt, and a durable per-user rate
  record. Same-ID/same-content retries reconcile; same-ID/different-content
  retries fail. Private receipts and rate state use the already inventoried
  scorebook audit subtree and include the exact instance for deletion cleanup.
- Current team managers remove v2 chat only through a verified, content-bound,
  idempotent moderation callable. The message is deleted promptly, the private
  audit receipt contains no public reason, and direct client mutation remains
  denied.

## Voice and AI

- Browser and native dictation produce an editable transcript. No raw audio is
  saved or uploaded.
- A transcript may be saved as a staff-private note, attached privately to a
  play, or sent to the AI parser as ephemeral input.
- AI returns a proposed typed command, confidence, and unresolved fields. It may
  not call the mutation API or mark a proposal official.
- Recaps, insights, practice suggestions, natural-language stat answers, and
  correction explanations cite canonical play identifiers and coverage.
- Corrections mark dependent AI artifacts stale until an authorized user
  regenerates and explicitly publishes them.

## Privacy and operations

- Public documents exclude scorer UIDs, notes, transcripts, audit records,
  private roster fields, and unrestricted AI prompts or outputs.
- Telemetry is restricted to allowlisted enums and numeric health metrics; it
  carries no team, player, game, play, note, or transcript identifiers.
- Deleting a game triggers idempotent recursive cleanup of all Diamond private
  and public children. Soft-deactivated teams cannot activate or score games.
- Rollback stops new activation first, then ordinary scoring commands. Existing
  read, manager-confirmed cancellation, correction, projection, and cleanup
  paths remain operational.
