# Requirements

## Eligibility and compatibility

- Baseball and Softball team setup in legacy web and the React app use the same
  versioned rules-profile catalog.
- A manager may configure Diamond v2 without invalidating the existing generic
  stat config. Configuration failure leaves the team usable with legacy tools.
- Activation requires all three gates: an enabled global policy, explicit team
  opt-in, and a server-created per-game activation document.
- Only newly scheduled Baseball or Softball games with no meaningful legacy
  score, events, aggregates, live state, or completed status may activate.
- The first accepted Diamond command permanently locks the game to
  `trackingEngine: "diamond-v2"`. Unknown nonempty engine values fail closed.
- Legacy games, non-diamond sports, and old links retain their current routes and
  persistence behavior.

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
  confirmation. Corrections remain possible for authorized staff after final.

## Rules

- Rules profiles are immutable and versioned. A game pins its profile and
  catalog versions at activation.
- Baseball profiles cover OBR-style, NFHS-style, and configurable youth rules.
- Fastpitch profiles independently model DP/FLEX, starter re-entry, courtesy
  runners, EP/EH configuration, illegal pitches, look-back/leaving early,
  dropped-third-strike eligibility, tiebreakers, and run-ahead rules.
- Scheduled innings, time limits, inning run limits, mercy rules, tiebreakers,
  continuous batting, free substitution, DH/EH/EP, and ERA inning basis are
  explicit parameters rather than sport-wide constants.

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
- Rollback stops new activation first, then new commands. Existing read,
  correction, projection, and cleanup paths remain operational.

