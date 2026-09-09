"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DIAMOND_SCHEMA_VERSION,
  createDiamondCheckpoint,
  createDiamondLedger,
  executeDiamondCommand,
  executeDiamondCommandFromCheckpoint,
  projectDiamondStats,
  reduceDiamondEvent,
  replayDiamondLedger,
  verifyDiamondLedger,
} = require("../diamond-engine");
const {
  DiamondProjectionError,
  buildDiamondEffectsPlan,
  buildDiamondProjectionBundle,
  buildDiamondPublicPlays,
  buildDiamondReplayPages,
  buildDiamondSharedGameOutcome,
  buildDiamondStatDocuments,
  getDiamondPublicProjectionHead,
  sanitizeDiamondPublicTeamStatDocument,
  serializeDiamondPublicStatsResponse,
} = require("../diamond-scorebook-projections.cjs");

const SCORER_UID = "scorer-1";
const INSTANCE_ID = "00000000-0000-4000-8000-000000000900";
const PRIVATE_SENTINEL = "MEDICAL-PRIVATE-TRANSCRIPT-ALPHA";
const DIRECTORY = Object.freeze({
  "away-1": { playerName: "Alex Away", playerNumber: "11" },
  "away-2": { playerName: "Bailey Away", playerNumber: "12" },
  "home-1": { playerName: "Casey Home", playerNumber: "21" },
  "home-2": { playerName: "Devon Home", playerNumber: "22" },
});
const ALL_PUBLIC_PLAYER_STAT_IDS = Object.freeze([
  "g",
  "gs",
  "pa",
  "ab",
  "r",
  "h",
  "1b",
  "2b",
  "3b",
  "hr",
  "tb",
  "rbi",
  "bb",
  "ibb",
  "hbp",
  "so",
  "sf",
  "sh",
  "roe",
  "fc",
  "gidp",
  "avg",
  "obp",
  "slg",
  "ops",
  "bb_rate",
  "strikeout_rate",
  "sb",
  "cs",
  "pickoffs",
  "br_advances",
  "br_outs",
  "stolen_base_rate",
  "p_app",
  "p_gs",
  "w",
  "l",
  "sv",
  "bf",
  "ip_outs",
  "p_h",
  "p_r",
  "er",
  "p_bb",
  "p_ibb",
  "p_hbp",
  "p_so",
  "p_hr",
  "wp",
  "balk_illegal_pitch",
  "inherited_runners",
  "inherited_scored",
  "pitches",
  "strikes",
  "first_pitch_strikes",
  "innings_pitched",
  "era",
  "whip",
  "strikeout_walk_ratio",
  "strike_rate",
  "first_pitch_strike_rate",
  "defensive_outs",
  "po",
  "a",
  "e",
  "dp",
  "tp",
  "pb",
  "fp",
  "fpct",
  "chances",
]);
const ALL_PUBLIC_TEAM_STAT_IDS = Object.freeze([
  "r",
  "h",
  "e",
  "lob",
  "risp_opportunities",
  "risp_hits",
  "two_out_runs",
  "two_strike_pa",
  "two_strike_hits",
  "first_pitch_strike_opportunities",
  "first_pitch_strikes",
]);

function orientationFor(managedSide = "away", overrides = {}) {
  const opponentSide = managedSide === "home" ? "away" : "home";
  const managedTeamId = "team-away";
  const opponentTeamId = "team-opponent";
  const teamName = "Away Team";
  const opponentName = "Home Team";
  return {
    schemaVersion: 1,
    managedSide,
    opponentSide,
    managedTeamId,
    opponentTeamId,
    homeTeamId: managedSide === "home" ? managedTeamId : opponentTeamId,
    awayTeamId: managedSide === "away" ? managedTeamId : opponentTeamId,
    teamName,
    opponentName,
    homeName: managedSide === "home" ? teamName : opponentName,
    awayName: managedSide === "away" ? teamName : opponentName,
    ...overrides,
  };
}

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function harness(captureMode = "full", rulesProfileId = "baseball-youth") {
  let ledger = createDiamondLedger({
    teamId: "team-away",
    gameId: "game-1",
    rulesProfileId,
    rulesProfileVersion: 1,
    captureMode,
  });
  let nextId = 1;

  function submit(type, payload, actorUid = SCORER_UID, commandContext = {}) {
    const id = nextId;
    const command = {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      commandId: uuid(id),
      teamId: ledger.teamId,
      gameId: ledger.gameId,
      expectedRevision: ledger.state.revision,
      rulesProfileId: ledger.rulesProfileId,
      rulesProfileVersion: ledger.rulesProfileVersion,
      type,
      payload,
    };
    const result = executeDiamondCommand(ledger, command, {
      actorUid,
      eventId: `event-${String(id)}`,
      serverTimestampMs: 1_700_000_000_000 + id,
      ...commandContext,
    });
    assert.equal(
      result.result.outcome,
      "accepted",
      result.result.rejection?.message,
    );
    ledger = result.ledger;
    nextId += 1;
    return result.event;
  }

  function attempt(type, payload, actorUid = SCORER_UID, commandContext = {}) {
    const id = nextId;
    const command = {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      commandId: uuid(id),
      teamId: ledger.teamId,
      gameId: ledger.gameId,
      expectedRevision: ledger.state.revision,
      rulesProfileId: ledger.rulesProfileId,
      rulesProfileVersion: ledger.rulesProfileVersion,
      type,
      payload,
    };
    return executeDiamondCommand(ledger, command, {
      actorUid,
      eventId: `event-${String(id)}`,
      serverTimestampMs: 1_700_000_000_000 + id,
      ...commandContext,
    });
  }

  return {
    get ledger() {
      return ledger;
    },
    attempt,
    submit,
  };
}

function setLineupsAndStart(game, lineupSize = 2) {
  const entries = (side) =>
    Array.from({ length: lineupSize }, (_, index) => ({
      slot: index + 1,
      playerId: `${side}-${String(index + 1)}`,
      displayName: `${side === "home" ? "Home" : "Away"} Player ${String(index + 1)}`,
      jerseyNumber: String(index + 11),
    }));
  game.submit("activate", {
    initialScorerUid: SCORER_UID,
    captureMode: game.ledger.captureMode,
  });
  game.submit("set_lineup", {
    side: "home",
    entries: entries("home"),
  });
  game.submit("set_lineup", {
    side: "away",
    entries: entries("away"),
  });
  game.submit("set_defensive_alignment", {
    side: "home",
    assignments: [
      { playerId: "home-1", position: "P" },
      { playerId: "home-2", position: "C" },
    ],
  });
  game.submit("set_defensive_alignment", {
    side: "away",
    assignments: [
      { playerId: "away-1", position: "P" },
      { playerId: "away-2", position: "C" },
    ],
  });
  game.submit("start", {});
}

function currentMatchup(game) {
  const battingSide = game.ledger.state.inning.half === "top" ? "away" : "home";
  const fieldingSide = battingSide === "home" ? "away" : "home";
  const order = game.ledger.state.lineups[battingSide].battingOrder;
  const batterId =
    order[game.ledger.state.nextBatterSlot[battingSide]]?.activePlayerId;
  const pitcherId = game.ledger.state.lineups[fieldingSide].defense.P;
  assert.ok(
    batterId && pitcherId,
    "compiled fixture requires a current batter and pitcher",
  );
  return { batterId, pitcherId };
}

function recordOut(game) {
  const { batterId, pitcherId } = currentMatchup(game);
  game.submit("record_plate_appearance", {
    batterId,
    pitcherId,
    result: "ground_out",
    batterAdvance: { to: "out", outKind: "batter_runner" },
    runnerAdvances: [],
    outsOnPlay: 1,
  });
}

function placeRunnerOnBase(game, base) {
  const { batterId, pitcherId } = currentMatchup(game);
  const result =
    base === "first" ? "single" : base === "second" ? "double" : "triple";
  game.submit("record_plate_appearance", {
    batterId,
    pitcherId,
    result,
    batterAdvance: { to: base },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  return batterId;
}

function advanceToHalf(game, inning, half) {
  const ordinal = (number, currentHalf) =>
    (number - 1) * 2 + (currentHalf === "bottom" ? 1 : 0);
  const target = ordinal(inning, half);
  while (
    ordinal(game.ledger.state.inning.number, game.ledger.state.inning.half) <
    target
  ) {
    while (game.ledger.state.inning.outs < 3) recordOut(game);
    game.submit("advance_half_inning", {});
  }
}

function addHomeRun(game, { pitch = true } = {}) {
  if (pitch) {
    game.submit("record_pitch", {
      batterId: "away-1",
      pitcherId: "home-1",
      result: "in_play",
    });
  }
  return game.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "home_run",
    batterAdvance: {
      to: "home",
      cause: "batted_ball",
      countsRun: true,
      earned: true,
      rbi: true,
    },
    runnerAdvances: [],
    outsOnPlay: 0,
    runsBattedIn: 1,
  });
}

function buildFullGameWithPrivateData() {
  const game = harness("full");
  setLineupsAndStart(game);
  const homeRun = addHomeRun(game);
  game.submit("rules_decision", {
    code: "coverage_adjustment",
    description: PRIVATE_SENTINEL,
    affectedFamilies: ["situational"],
  });
  game.submit("private_note", {
    text: PRIVATE_SENTINEL,
    attachedEventId: homeRun.eventId,
    visibility: "staff-private",
  });
  return { game, homeRun };
}

function bundleFor(ledger, overrides = {}) {
  return buildDiamondProjectionBundle({
    ledger,
    instanceId: INSTANCE_ID,
    orientationSnapshot: orientationFor("away"),
    playerDirectory: DIRECTORY,
    publicPlayerStatIds: ALL_PUBLIC_PLAYER_STAT_IDS,
    publicTeamStatIds: ALL_PUBLIC_TEAM_STAT_IDS,
    ...overrides,
  });
}

function playerWrite(bundle, playerId) {
  return bundle.writes.publicPlayerStats.find(
    (write) => write.playerId === playerId,
  )?.data;
}

test("compiled reducer canonicalizes omitted tiebreaker pitcher responsibility and rejects unavailable or mismatched identity", () => {
  const game = harness("quick", "fastpitch-nfhs");
  setLineupsAndStart(game);
  const extraInning = {
    ...game.ledger.state,
    inning: { ...game.ledger.state.inning, number: 8 },
  };
  const placed = reduceDiamondEvent(extraInning, {
    type: "place_tiebreaker_runner",
    eventId: "compiled-tiebreaker",
    payload: { side: "away", runnerId: "away-2", base: "second" },
  });
  assert.deepEqual(placed.bases.second, {
    runnerId: "away-2",
    chargedToPitcherId: "home-1",
    courtesyForPlayerId: null,
    reachedOnEventId: "compiled-tiebreaker",
  });
  assert.throws(
    () =>
      reduceDiamondEvent(extraInning, {
        type: "place_tiebreaker_runner",
        eventId: "compiled-tiebreaker-mismatch",
        payload: {
          side: "away",
          runnerId: "away-2",
          base: "second",
          chargedToPitcherId: "home-2",
        },
      }),
    (error) => error?.code === "unexpected-responsible-pitcher",
  );
  assert.throws(
    () =>
      reduceDiamondEvent(
        {
          ...extraInning,
          lineups: {
            ...extraInning.lineups,
            home: {
              ...extraInning.lineups.home,
              defense: { C: "home-2" },
            },
          },
        },
        {
          type: "place_tiebreaker_runner",
          eventId: "compiled-tiebreaker-no-pitcher",
          payload: { side: "away", runnerId: "away-2", base: "second" },
        },
      ),
    (error) => error?.code === "missing-defensive-pitcher",
  );
});

test("compiled substitutions transfer only a live batting runner and preserve exact base provenance", () => {
  const game = harness("quick", "fastpitch-nfhs");
  setLineupsAndStart(game);
  game.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  const beforeSubstitution = game.ledger.state;
  const originalPlacement = beforeSubstitution.bases.first;
  assert.ok(originalPlacement);

  game.submit("substitute", {
    side: "away",
    battingSlot: 1,
    outgoingPlayerId: "away-1",
    incomingPlayerId: "away-pinch-runner",
  });
  assert.deepEqual(game.ledger.state.bases.first, {
    ...originalPlacement,
    runnerId: "away-pinch-runner",
  });
  game.submit("re_enter", {
    side: "away",
    battingSlot: 1,
    starterPlayerId: "away-1",
    replacedPlayerId: "away-pinch-runner",
  });
  assert.deepEqual(game.ledger.state.bases.first, originalPlacement);
  assert.equal(verifyDiamondLedger(game.ledger), true);
  assert.deepEqual(replayDiamondLedger(game.ledger).state, game.ledger.state);

  const provenancePlacement = {
    ...originalPlacement,
    courtesyForPlayerId: "away-catcher",
  };
  for (const base of ["first", "second", "third"]) {
    const provenanceTransfer = reduceDiamondEvent(
      {
        ...beforeSubstitution,
        bases: {
          first: null,
          second: null,
          third: null,
          [base]: provenancePlacement,
        },
      },
      {
        type: "substitute",
        eventId: `compiled-metadata-preserving-${base}-runner-substitution`,
        payload: {
          side: "away",
          battingSlot: 1,
          outgoingPlayerId: "away-1",
          incomingPlayerId: "away-metadata-sub",
        },
      },
    );
    assert.deepEqual(provenanceTransfer.bases[base], {
      ...provenancePlacement,
      runnerId: "away-metadata-sub",
    });
  }

  const untouched = reduceDiamondEvent(beforeSubstitution, {
    type: "substitute",
    eventId: "compiled-non-runner-substitution",
    payload: {
      side: "away",
      battingSlot: 2,
      outgoingPlayerId: "away-2",
      incomingPlayerId: "away-2-sub",
    },
  });
  assert.deepEqual(untouched.bases.first, originalPlacement);

  const endedHalf = {
    ...beforeSubstitution,
    inning: { ...beforeSubstitution.inning, outs: 3 },
  };
  const betweenInnings = reduceDiamondEvent(endedHalf, {
    type: "substitute",
    eventId: "compiled-between-innings-substitution",
    payload: {
      side: "away",
      battingSlot: 1,
      outgoingPlayerId: "away-1",
      incomingPlayerId: "away-between-innings",
    },
  });
  assert.deepEqual(betweenInnings.bases.first, originalPlacement);

  const endedHalfIncomingPlacement = {
    ...originalPlacement,
    runnerId: "away-ended-half-incoming",
  };
  const endedHalfIncoming = reduceDiamondEvent(
    {
      ...endedHalf,
      bases: { ...endedHalf.bases, first: endedHalfIncomingPlacement },
    },
    {
      type: "substitute",
      eventId: "compiled-between-innings-stale-incoming-runner",
      payload: {
        side: "away",
        battingSlot: 1,
        outgoingPlayerId: "away-1",
        incomingPlayerId: "away-ended-half-incoming",
      },
    },
  );
  assert.deepEqual(endedHalfIncoming.bases.first, endedHalfIncomingPlacement);
  assert.equal(
    endedHalfIncoming.lineups.away.battingOrder[0].activePlayerId,
    "away-ended-half-incoming",
  );

  const runLimitGame = harness("quick", "baseball-youth");
  setLineupsAndStart(runLimitGame);
  runLimitGame.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  const runLimitPlacement = runLimitGame.ledger.state.bases.first;
  assert.ok(runLimitPlacement);
  const runLimitPlan = reduceDiamondEvent(
    {
      ...runLimitGame.ledger.state,
      score: { ...runLimitGame.ledger.state.score, away: 5 },
      inningRuns: { ...runLimitGame.ledger.state.inningRuns, T1: 5 },
    },
    {
      type: "substitute",
      eventId: "compiled-run-limit-pending-substitution",
      payload: {
        side: "away",
        battingSlot: 1,
        outgoingPlayerId: "away-1",
        incomingPlayerId: "away-run-limit-plan",
      },
    },
  );
  assert.deepEqual(runLimitPlan.bases.first, {
    ...runLimitPlacement,
    runnerId: "away-run-limit-plan",
  });

  const collidingPlacement = {
    runnerId: "home-1",
    chargedToPitcherId: "home-1",
    courtesyForPlayerId: "away-1",
    reachedOnEventId: "compiled-cross-team-id-collision",
  };
  const defensiveChange = reduceDiamondEvent(
    {
      ...beforeSubstitution,
      bases: { ...beforeSubstitution.bases, first: collidingPlacement },
    },
    {
      type: "substitute",
      eventId: "compiled-defensive-id-collision",
      payload: {
        side: "home",
        battingSlot: 1,
        outgoingPlayerId: "home-1",
        incomingPlayerId: "home-reliever",
        defensivePosition: "P",
      },
    },
  );
  assert.deepEqual(defensiveChange.bases.first, collidingPlacement);

  for (const action of [
    {
      type: "substitute",
      eventId: "compiled-no-op-substitution",
      payload: {
        side: "away",
        battingSlot: 1,
        outgoingPlayerId: "away-1",
        incomingPlayerId: "away-1",
      },
    },
    {
      type: "re_enter",
      eventId: "compiled-no-op-reentry",
      payload: {
        side: "away",
        battingSlot: 1,
        starterPlayerId: "away-1",
        replacedPlayerId: "away-1",
      },
    },
  ]) {
    assert.throws(
      () => reduceDiamondEvent(beforeSubstitution, action),
      (error) => error?.code === "substitution-no-op",
    );
  }
  assert.equal(
    beforeSubstitution.lineups.away.battingOrder[0].starterReentriesUsed,
    0,
  );

  const occupiedIncoming = {
    ...originalPlacement,
    runnerId: "away-incoming",
  };
  assert.throws(
    () =>
      reduceDiamondEvent(
        {
          ...beforeSubstitution,
          bases: { ...beforeSubstitution.bases, first: occupiedIncoming },
        },
        {
          type: "substitute",
          eventId: "compiled-incoming-already-on-base",
          payload: {
            side: "away",
            battingSlot: 1,
            outgoingPlayerId: "away-1",
            incomingPlayerId: "away-incoming",
          },
        },
      ),
    (error) => error?.code === "incoming-runner-on-base",
  );
});

test("compiled substituted runner scores with original pitcher responsibility and deterministic stats", () => {
  const game = harness("quick", "fastpitch-nfhs");
  setLineupsAndStart(game);
  game.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  const reachedOnEventId = game.ledger.state.bases.first?.reachedOnEventId;
  game.submit("substitute", {
    side: "away",
    battingSlot: 1,
    outgoingPlayerId: "away-1",
    incomingPlayerId: "away-pinch-runner",
  });
  assert.deepEqual(game.ledger.state.bases.first, {
    runnerId: "away-pinch-runner",
    chargedToPitcherId: "home-1",
    courtesyForPlayerId: null,
    reachedOnEventId,
  });
  game.submit("advance_runner", {
    runnerId: "away-pinch-runner",
    from: "first",
    to: "home",
    cause: "batted_ball",
    countsRun: true,
    earned: true,
    rbi: false,
  });

  const stats = projectDiamondStats(game.ledger);
  assert.equal(stats.players["away-pinch-runner"].raw.batting.R, 1);
  assert.equal(stats.players["away-pinch-runner"].raw.baserunning.advances, 1);
  assert.deepEqual(
    {
      R: stats.players["home-1"].raw.pitching.R,
      ER: stats.players["home-1"].raw.pitching.ER,
    },
    { R: 1, ER: 1 },
  );
  assert.equal(verifyDiamondLedger(game.ledger), true);
  assert.deepEqual(replayDiamondLedger(game.ledger).state, game.ledger.state);
  assert.deepEqual(projectDiamondStats(game.ledger), stats);
});

test("compiled runner moves reject same-base and backward destinations across commands and correction replay", () => {
  const matrix = [
    {
      from: "first",
      allowed: ["stay", "second", "third", "home", "out"],
      rejected: ["first"],
    },
    {
      from: "second",
      allowed: ["stay", "third", "home", "out"],
      rejected: ["first", "second"],
    },
    {
      from: "third",
      allowed: ["stay", "home", "out"],
      rejected: ["first", "second", "third"],
    },
  ];

  for (const { from, allowed, rejected } of matrix) {
    for (const to of allowed) {
      const game = harness("quick", "baseball-nfhs");
      setLineupsAndStart(game, 6);
      const runnerId = placeRunnerOnBase(game, from);
      game.submit("advance_runner", {
        runnerId,
        from,
        to,
        cause: "other",
        ...(to === "out" ? { outKind: "tag" } : {}),
      });
      if (to === "stay") {
        assert.equal(
          projectDiamondStats(game.ledger).players[runnerId].raw.baserunning
            .advances,
          0,
        );
      }
      assert.deepEqual(
        replayDiamondLedger(game.ledger).state,
        game.ledger.state,
      );
    }

    for (const to of rejected) {
      const standalone = harness("quick", "baseball-nfhs");
      setLineupsAndStart(standalone, 6);
      const standaloneRunnerId = placeRunnerOnBase(standalone, from);
      const standaloneAttempt = standalone.attempt("advance_runner", {
        runnerId: standaloneRunnerId,
        from,
        to,
        cause: "other",
      });
      assert.equal(standaloneAttempt.result.outcome, "rejected");
      assert.equal(
        standaloneAttempt.result.rejection?.code,
        "invalid-runner-destination",
      );

      const plateAppearance = harness("quick", "baseball-nfhs");
      setLineupsAndStart(plateAppearance, 6);
      const plateAppearanceRunnerId = placeRunnerOnBase(plateAppearance, from);
      const { batterId, pitcherId } = currentMatchup(plateAppearance);
      const plateAppearanceAttempt = plateAppearance.attempt(
        "record_plate_appearance",
        {
          batterId,
          pitcherId,
          result: "ground_out",
          batterAdvance: { to: "out", outKind: "batter_runner" },
          runnerAdvances: [
            {
              runnerId: plateAppearanceRunnerId,
              from,
              to,
              cause: "batted_ball",
            },
          ],
          outsOnPlay: 1,
        },
      );
      assert.equal(plateAppearanceAttempt.result.outcome, "rejected");
      assert.equal(
        plateAppearanceAttempt.result.rejection?.code,
        "invalid-runner-destination",
      );
    }
  }

  const correction = harness("quick", "baseball-nfhs");
  setLineupsAndStart(correction, 6);
  const runnerId = placeRunnerOnBase(correction, "first");
  const advance = correction.submit("advance_runner", {
    runnerId,
    from: "first",
    to: "second",
    cause: "other",
  });
  const beforeCorrection = correction.ledger;
  const correctionAttempt = correction.attempt("supersede_event", {
    targetEventId: advance.eventId,
    reason: "Attempt an invalid backward correction.",
    replacement: {
      type: "advance_runner",
      payload: { runnerId, from: "first", to: "first", cause: "other" },
    },
  });
  assert.equal(correctionAttempt.result.outcome, "rejected");
  assert.equal(
    correctionAttempt.result.rejection?.code,
    "invalid-runner-destination",
  );
  assert.strictEqual(correction.ledger, beforeCorrection);
  assert.equal(verifyDiamondLedger(correction.ledger), true);
  assert.deepEqual(
    replayDiamondLedger(correction.ledger).state,
    correction.ledger.state,
  );
});

test("compiled runner moves reject order reversals and preserve simultaneous advances and replay", () => {
  const standalone = harness("quick", "baseball-nfhs");
  setLineupsAndStart(standalone, 6);
  const leadingRunnerId = placeRunnerOnBase(standalone, "second");
  const trailingRunnerId = placeRunnerOnBase(standalone, "first");
  const standaloneRevision = standalone.ledger.state.revision;
  const standaloneAttempt = standalone.attempt("advance_runner", {
    runnerId: trailingRunnerId,
    from: "first",
    to: "third",
    cause: "other",
  });
  assert.equal(standaloneAttempt.result.outcome, "rejected");
  assert.equal(
    standaloneAttempt.result.rejection?.code,
    "runner-order-violation",
  );
  assert.equal(standaloneAttempt.ledger.state.revision, standaloneRevision);
  assert.equal(standalone.ledger.state.bases.first?.runnerId, trailingRunnerId);
  assert.equal(standalone.ledger.state.bases.second?.runnerId, leadingRunnerId);
  assert.equal(standalone.ledger.state.bases.third, null);

  const plateAppearance = harness("quick", "baseball-nfhs");
  setLineupsAndStart(plateAppearance, 6);
  const heldRunnerId = placeRunnerOnBase(plateAppearance, "first");
  const matchup = currentMatchup(plateAppearance);
  const plateAppearanceRevision = plateAppearance.ledger.state.revision;
  const plateAppearanceAttempt = plateAppearance.attempt(
    "record_plate_appearance",
    {
      ...matchup,
      result: "double",
      batterAdvance: { to: "second" },
      runnerAdvances: [
        {
          runnerId: heldRunnerId,
          from: "first",
          to: "stay",
          cause: "batted_ball",
        },
      ],
      outsOnPlay: 0,
    },
  );
  assert.equal(plateAppearanceAttempt.result.outcome, "rejected");
  assert.equal(
    plateAppearanceAttempt.result.rejection?.code,
    "runner-order-violation",
  );
  assert.equal(
    plateAppearanceAttempt.ledger.state.revision,
    plateAppearanceRevision,
  );

  const simultaneous = harness("quick", "baseball-nfhs");
  setLineupsAndStart(simultaneous, 6);
  const runnerFromSecond = placeRunnerOnBase(simultaneous, "second");
  const runnerFromFirst = placeRunnerOnBase(simultaneous, "first");
  const simultaneousMatchup = currentMatchup(simultaneous);
  simultaneous.submit("record_plate_appearance", {
    ...simultaneousMatchup,
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [
      {
        runnerId: runnerFromSecond,
        from: "second",
        to: "third",
        cause: "batted_ball",
      },
      {
        runnerId: runnerFromFirst,
        from: "first",
        to: "second",
        cause: "batted_ball",
      },
    ],
    outsOnPlay: 0,
  });
  assert.equal(
    simultaneous.ledger.state.bases.first?.runnerId,
    simultaneousMatchup.batterId,
  );
  assert.equal(
    simultaneous.ledger.state.bases.second?.runnerId,
    runnerFromFirst,
  );
  assert.equal(
    simultaneous.ledger.state.bases.third?.runnerId,
    runnerFromSecond,
  );
  assert.deepEqual(
    replayDiamondLedger(simultaneous.ledger).state,
    simultaneous.ledger.state,
  );

  const correction = harness("quick", "baseball-nfhs");
  setLineupsAndStart(correction, 6);
  placeRunnerOnBase(correction, "second");
  const correctionRunnerId = placeRunnerOnBase(correction, "first");
  const stay = correction.submit("advance_runner", {
    runnerId: correctionRunnerId,
    from: "first",
    to: "stay",
    cause: "other",
  });
  const correctionRevision = correction.ledger.state.revision;
  const correctionAttempt = correction.attempt("supersede_event", {
    targetEventId: stay.eventId,
    reason:
      "Do not let the trailing runner pass the historical preceding runner.",
    replacement: {
      type: "advance_runner",
      payload: {
        runnerId: correctionRunnerId,
        from: "first",
        to: "third",
        cause: "other",
      },
    },
  });
  assert.equal(correctionAttempt.result.outcome, "rejected");
  assert.equal(
    correctionAttempt.result.rejection?.code,
    "runner-order-violation",
  );
  assert.equal(correctionAttempt.ledger.state.revision, correctionRevision);
  assert.equal(verifyDiamondLedger(correction.ledger), true);
  assert.deepEqual(
    replayDiamondLedger(correction.ledger).state,
    correction.ledger.state,
  );
});

test("compiled ordinary strikeout-to-first uses dropped-third eligibility and keeps old payloads replayable", () => {
  const emptyFirst = harness("quick", "baseball-nfhs");
  setLineupsAndStart(emptyFirst, 6);
  emptyFirst.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "strikeout",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  assert.equal(emptyFirst.ledger.state.bases.first?.runnerId, "away-1");
  assert.equal(
    projectDiamondStats(emptyFirst.ledger).players["away-1"].raw.batting.SO,
    1,
  );
  assert.deepEqual(
    replayDiamondLedger(emptyFirst.ledger).state,
    emptyFirst.ledger.state,
  );

  const occupiedFirst = harness("quick", "baseball-nfhs");
  setLineupsAndStart(occupiedFirst, 6);
  placeRunnerOnBase(occupiedFirst, "first");
  recordOut(occupiedFirst);
  const blocked = occupiedFirst.attempt("record_plate_appearance", {
    batterId: "away-3",
    pitcherId: "home-1",
    result: "strikeout",
    batterAdvance: { to: "first" },
    runnerAdvances: [
      { runnerId: "away-1", from: "first", to: "second", cause: "other" },
    ],
    outsOnPlay: 0,
  });
  assert.equal(blocked.result.outcome, "rejected");
  assert.equal(
    blocked.result.rejection?.code,
    "dropped-third-strike-ineligible",
  );

  recordOut(occupiedFirst);
  occupiedFirst.submit("record_plate_appearance", {
    batterId: "away-4",
    pitcherId: "home-1",
    result: "strikeout",
    batterAdvance: { to: "first" },
    runnerAdvances: [
      { runnerId: "away-1", from: "first", to: "second", cause: "other" },
    ],
    outsOnPlay: 0,
  });
  assert.equal(occupiedFirst.ledger.state.bases.first?.runnerId, "away-4");
  assert.equal(occupiedFirst.ledger.state.bases.second?.runnerId, "away-1");
  assert.deepEqual(
    replayDiamondLedger(occupiedFirst.ledger).state,
    occupiedFirst.ledger.state,
  );

  const legacyDroppedThird = harness("quick", "baseball-nfhs");
  setLineupsAndStart(legacyDroppedThird, 6);
  legacyDroppedThird.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "dropped_third_strike",
    batterAdvance: { to: "second", cause: "error" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  assert.equal(
    legacyDroppedThird.ledger.state.bases.second?.runnerId,
    "away-1",
  );
  assert.deepEqual(
    replayDiamondLedger(legacyDroppedThird.ledger).state,
    legacyDroppedThird.ledger.state,
  );

  const droppedThirdOut = harness("quick", "baseball-nfhs");
  setLineupsAndStart(droppedThirdOut, 6);
  droppedThirdOut.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "dropped_third_strike",
    batterAdvance: { to: "out" },
    runnerAdvances: [],
    outsOnPlay: 1,
  });
  assert.equal(droppedThirdOut.ledger.state.inning.outs, 1);
  assert.deepEqual(
    replayDiamondLedger(droppedThirdOut.ledger).state,
    droppedThirdOut.ledger.state,
  );
});

test("compiled reducer blocks every pitch after a terminal pitch result until plate-appearance resolution", () => {
  const terminalResults = ["in_play", "hit_by_pitch", "catcher_interference"];
  const followupResults = [
    "ball",
    "called_strike",
    "swinging_strike",
    "foul",
    "foul_bunt",
    "in_play",
    "hit_by_pitch",
    "catcher_interference",
    "illegal_pitch",
    "balk",
    "pickoff_attempt",
  ];

  for (const terminalResult of terminalResults) {
    const game = harness("full", "baseball-nfhs");
    setLineupsAndStart(game, 6);
    const matchup = currentMatchup(game);
    game.submit("record_pitch", { ...matchup, result: terminalResult });
    const terminalRevision = game.ledger.state.revision;

    for (const result of followupResults) {
      const blocked = game.attempt("record_pitch", { ...matchup, result });
      assert.equal(blocked.result.outcome, "rejected");
      assert.equal(blocked.result.rejection?.code, "plate-appearance-pending");
      assert.equal(blocked.ledger.state.revision, terminalRevision);
      assert.equal(game.ledger.state.inning.lastPitchResult, terminalResult);
    }

    if (terminalResult === "in_play") {
      game.submit("record_plate_appearance", {
        ...matchup,
        result: "single",
        batterAdvance: { to: "first" },
        runnerAdvances: [],
        outsOnPlay: 0,
      });
    } else if (terminalResult === "hit_by_pitch") {
      game.submit("record_plate_appearance", {
        ...matchup,
        result: "hit_by_pitch",
        batterAdvance: { to: "first", cause: "hit_by_pitch" },
        runnerAdvances: [],
        outsOnPlay: 0,
      });
    } else {
      game.submit("record_plate_appearance", {
        ...matchup,
        result: "interference",
        batterAdvance: { to: "first" },
        runnerAdvances: [],
        outsOnPlay: 0,
      });
    }

    assert.equal(game.ledger.state.inning.lastPitchResult, null);
    game.submit("record_pitch", {
      ...currentMatchup(game),
      result: "ball",
    });
    assert.equal(
      projectDiamondStats(game.ledger).players["home-1"].raw.pitching.pitches,
      2,
    );
    assert.deepEqual(replayDiamondLedger(game.ledger).state, game.ledger.state);
  }

  const corrected = harness("full", "baseball-nfhs");
  setLineupsAndStart(corrected, 6);
  const matchup = currentMatchup(corrected);
  const terminal = corrected.submit("record_pitch", {
    ...matchup,
    result: "in_play",
  });
  corrected.submit("supersede_event", {
    targetEventId: terminal.eventId,
    reason:
      "Correct the terminal pitch result before recording the next pitch.",
    replacement: {
      type: "record_pitch",
      payload: { ...matchup, result: "ball" },
    },
  });
  corrected.submit("record_pitch", { ...matchup, result: "called_strike" });
  assert.deepEqual(
    {
      balls: corrected.ledger.state.inning.balls,
      strikes: corrected.ledger.state.inning.strikes,
      lastPitchResult: corrected.ledger.state.inning.lastPitchResult,
    },
    { balls: 1, strikes: 1, lastPitchResult: "called_strike" },
  );
  assert.equal(
    projectDiamondStats(corrected.ledger).players["home-1"].raw.pitching
      .pitches,
    2,
  );
  assert.deepEqual(
    replayDiamondLedger(corrected.ledger).state,
    corrected.ledger.state,
  );

  for (const terminalResult of terminalResults) {
    const invalidCorrection = harness("full", "baseball-nfhs");
    setLineupsAndStart(invalidCorrection, 6);
    const correctionMatchup = currentMatchup(invalidCorrection);
    const firstPitch = invalidCorrection.submit("record_pitch", {
      ...correctionMatchup,
      result: "ball",
    });
    invalidCorrection.submit("record_pitch", {
      ...correctionMatchup,
      result: "called_strike",
    });
    const beforeCorrection = invalidCorrection.ledger;
    const rejected = invalidCorrection.attempt("supersede_event", {
      targetEventId: firstPitch.eventId,
      reason: `Do not introduce ${terminalResult} before an already-recorded later pitch.`,
      replacement: {
        type: "record_pitch",
        payload: { ...correctionMatchup, result: terminalResult },
      },
    });
    assert.equal(rejected.result.outcome, "rejected");
    assert.equal(rejected.result.rejection?.code, "plate-appearance-pending");
    assert.equal(
      rejected.ledger.state.revision,
      beforeCorrection.state.revision,
    );
    assert.strictEqual(invalidCorrection.ledger, beforeCorrection);
    assert.deepEqual(
      replayDiamondLedger(invalidCorrection.ledger).state,
      invalidCorrection.ledger.state,
    );
  }
});

test("compiled third-out run timing is explicit and independent of move array order", () => {
  const game = harness("quick", "baseball-nfhs");
  setLineupsAndStart(game, 5);
  game.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "triple",
    batterAdvance: { to: "third" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  game.submit("record_plate_appearance", {
    batterId: "away-2",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  recordOut(game);
  const beforePlay = game.ledger.state;
  assert.equal(beforePlay.inning.outs, 1);

  const mixedPayload = (countsRun, taggedRunnerFirst = false) => {
    const scoringAdvance = {
      runnerId: "away-1",
      from: "third",
      to: "home",
      cause: "batted_ball",
      ...(countsRun === undefined ? {} : { countsRun }),
      earned: true,
      rbi: false,
    };
    const taggedRunner = {
      runnerId: "away-2",
      from: "first",
      to: "out",
      cause: "tag_out",
      outKind: "tag",
    };
    return {
      batterId: "away-4",
      pitcherId: "home-1",
      result: "ground_out",
      batterAdvance: { to: "out", outKind: "batter_runner" },
      runnerAdvances: taggedRunnerFirst
        ? [taggedRunner, scoringAdvance]
        : [scoringAdvance, taggedRunner],
      outsOnPlay: 2,
    };
  };

  assert.throws(
    () =>
      reduceDiamondEvent(beforePlay, {
        type: "record_plate_appearance",
        eventId: "compiled-mixed-missing-run-timing",
        payload: mixedPayload(undefined),
      }),
    (error) => error?.code === "run-timing-required",
  );
  const malformed = mixedPayload(true);
  malformed.runnerAdvances.find((advance) => advance.to === "home").countsRun =
    "yes";
  assert.throws(
    () =>
      reduceDiamondEvent(beforePlay, {
        type: "record_plate_appearance",
        eventId: "compiled-mixed-malformed-run-timing",
        payload: malformed,
      }),
    (error) => error?.code === "invalid-boolean",
  );

  for (const taggedRunnerFirst of [false, true]) {
    const after = reduceDiamondEvent(beforePlay, {
      type: "record_plate_appearance",
      eventId: `compiled-mixed-order-${String(taggedRunnerFirst)}`,
      payload: mixedPayload(true, taggedRunnerFirst),
    });
    assert.deepEqual(after.score, { home: 0, away: 1 });
    assert.equal(after.inning.outs, 3);
  }
  const noRun = reduceDiamondEvent(beforePlay, {
    type: "record_plate_appearance",
    eventId: "compiled-mixed-explicit-no-run",
    payload: mixedPayload(false),
  });
  assert.equal(noRun.score.away, 0);

  const allCancelling = mixedPayload(true);
  allCancelling.runnerAdvances = allCancelling.runnerAdvances.map((advance) =>
    advance.to === "out"
      ? { ...advance, cause: "force_out", outKind: "force" }
      : advance,
  );
  assert.throws(
    () =>
      reduceDiamondEvent(beforePlay, {
        type: "record_plate_appearance",
        eventId: "compiled-all-cancelling-outs",
        payload: allCancelling,
      }),
    (error) => error?.code === "run-cannot-count",
  );

  const twoOutState = {
    ...beforePlay,
    inning: { ...beforePlay.inning, outs: 2 },
  };
  for (const [result, outKind] of [
    ["fly_out", "catch"],
    ["strikeout", "strikeout"],
    ["fielders_choice", "tag"],
  ]) {
    assert.throws(
      () =>
        reduceDiamondEvent(twoOutState, {
          type: "record_plate_appearance",
          eventId: `compiled-batter-third-out-${result}`,
          payload: {
            batterId: "away-4",
            pitcherId: "home-1",
            result,
            batterAdvance: { to: "out", outKind },
            runnerAdvances: [
              {
                runnerId: "away-1",
                from: "third",
                to: "home",
                cause: "batted_ball",
                countsRun: true,
                earned: true,
                rbi: false,
              },
            ],
            outsOnPlay: 1,
          },
        }),
      (error) => error?.code === "run-cannot-count",
    );
  }

  const allTagAppealState = {
    ...beforePlay,
    bases: {
      ...beforePlay.bases,
      second: {
        runnerId: "away-extra",
        chargedToPitcherId: "home-1",
        courtesyForPlayerId: null,
        reachedOnEventId: "compiled-extra-runner",
      },
    },
  };
  const allTagAppeal = reduceDiamondEvent(allTagAppealState, {
    type: "record_plate_appearance",
    eventId: "compiled-all-tag-appeal-outs",
    payload: {
      batterId: "away-4",
      pitcherId: "home-1",
      result: "fielders_choice",
      batterAdvance: { to: "first" },
      runnerAdvances: [
        {
          runnerId: "away-1",
          from: "third",
          to: "home",
          cause: "batted_ball",
          countsRun: true,
          earned: true,
          rbi: false,
        },
        {
          runnerId: "away-extra",
          from: "second",
          to: "out",
          cause: "appeal_out",
          outKind: "appeal",
        },
        {
          runnerId: "away-2",
          from: "first",
          to: "out",
          cause: "tag_out",
          outKind: "tag",
        },
      ],
      outsOnPlay: 2,
    },
  });
  assert.equal(allTagAppeal.score.away, 1);

  game.submit("record_plate_appearance", mixedPayload(true, true));
  assert.equal(game.ledger.state.score.away, 1);
  assert.equal(
    projectDiamondStats(game.ledger).players["away-1"].raw.batting.R,
    1,
  );
  assert.equal(verifyDiamondLedger(game.ledger), true);
  assert.deepEqual(replayDiamondLedger(game.ledger).state, game.ledger.state);
});

test("compiled hit, multi-out, and fielding invariants use canonical runner outcomes", () => {
  const loadBases = () => {
    const game = harness("quick", "baseball-nfhs");
    setLineupsAndStart(game, 4);
    game.submit("record_plate_appearance", {
      batterId: "away-1",
      pitcherId: "home-1",
      result: "single",
      batterAdvance: { to: "first" },
      runnerAdvances: [],
      outsOnPlay: 0,
    });
    game.submit("record_plate_appearance", {
      batterId: "away-2",
      pitcherId: "home-1",
      result: "single",
      batterAdvance: { to: "first" },
      runnerAdvances: [
        {
          runnerId: "away-1",
          from: "first",
          to: "second",
          cause: "batted_ball",
        },
      ],
      outsOnPlay: 0,
    });
    game.submit("record_plate_appearance", {
      batterId: "away-3",
      pitcherId: "home-1",
      result: "single",
      batterAdvance: { to: "first" },
      runnerAdvances: [
        {
          runnerId: "away-1",
          from: "second",
          to: "third",
          cause: "batted_ball",
        },
        {
          runnerId: "away-2",
          from: "first",
          to: "second",
          cause: "batted_ball",
        },
      ],
      outsOnPlay: 0,
    });
    return game;
  };

  const incompleteHomeRun = loadBases();
  assert.equal(
    incompleteHomeRun.attempt("record_plate_appearance", {
      batterId: "away-4",
      pitcherId: "home-1",
      result: "home_run",
      batterAdvance: { to: "home", countsRun: true },
      runnerAdvances: [],
      outsOnPlay: 0,
      runsBattedIn: 1,
    }).result.rejection?.code,
    "incomplete-hit-runner-resolution",
  );
  assert.equal(incompleteHomeRun.ledger.state.bases.first.runnerId, "away-3");
  assert.equal(
    incompleteHomeRun.attempt("record_plate_appearance", {
      batterId: "away-4",
      pitcherId: "home-1",
      result: "home_run",
      batterAdvance: { to: "home", countsRun: true },
      runnerAdvances: [
        {
          runnerId: "away-3",
          from: "first",
          to: "home",
          cause: "batted_ball",
          countsRun: true,
        },
        {
          runnerId: "away-3",
          from: "first",
          to: "out",
          cause: "tag_out",
          outKind: "tag",
        },
      ],
      outsOnPlay: 1,
      runsBattedIn: 2,
    }).result.rejection?.code,
    "duplicate-runner-source",
  );

  const invalidTriple = loadBases();
  assert.equal(
    invalidTriple.attempt("record_plate_appearance", {
      batterId: "away-4",
      pitcherId: "home-1",
      result: "triple",
      batterAdvance: { to: "third" },
      runnerAdvances: [
        {
          runnerId: "away-1",
          from: "third",
          to: "home",
          cause: "batted_ball",
          countsRun: true,
        },
        {
          runnerId: "away-2",
          from: "second",
          to: "out",
          cause: "tag_out",
          outKind: "tag",
        },
        {
          runnerId: "away-3",
          from: "first",
          to: "second",
          cause: "batted_ball",
        },
      ],
      outsOnPlay: 1,
    }).result.rejection?.code,
    "invalid-hit-runner-destination",
  );

  const validHomeRun = loadBases();
  validHomeRun.submit("record_plate_appearance", {
    batterId: "away-4",
    pitcherId: "home-1",
    result: "home_run",
    batterAdvance: {
      to: "home",
      countsRun: true,
      earned: true,
      rbi: true,
    },
    runnerAdvances: [
      {
        runnerId: "away-1",
        from: "third",
        to: "home",
        cause: "batted_ball",
        countsRun: true,
        earned: true,
        rbi: true,
      },
      {
        runnerId: "away-2",
        from: "second",
        to: "out",
        cause: "tag_out",
        outKind: "tag",
      },
      {
        runnerId: "away-3",
        from: "first",
        to: "home",
        cause: "batted_ball",
        countsRun: true,
        earned: true,
        rbi: true,
      },
    ],
    outsOnPlay: 1,
    runsBattedIn: 3,
  });
  assert.deepEqual(validHomeRun.ledger.state.bases, {
    first: null,
    second: null,
    third: null,
  });
  assert.equal(validHomeRun.ledger.state.score.away, 3);
  assert.deepEqual(
    replayDiamondLedger(validHomeRun.ledger).state,
    validHomeRun.ledger.state,
  );

  const multiOut = harness("quick", "baseball-nfhs");
  setLineupsAndStart(multiOut, 4);
  multiOut.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  multiOut.submit("record_plate_appearance", {
    batterId: "away-2",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [
      {
        runnerId: "away-1",
        from: "first",
        to: "second",
        cause: "batted_ball",
      },
    ],
    outsOnPlay: 0,
  });
  const threeOutMoves = [
    {
      runnerId: "away-1",
      from: "second",
      to: "out",
      cause: "force_out",
      outKind: "force",
    },
    {
      runnerId: "away-2",
      from: "first",
      to: "out",
      cause: "force_out",
      outKind: "force",
    },
  ];
  assert.equal(
    multiOut.attempt("record_plate_appearance", {
      batterId: "away-3",
      pitcherId: "home-1",
      result: "double_play",
      batterAdvance: { to: "first" },
      runnerAdvances: threeOutMoves,
      outsOnPlay: 2,
    }).result.rejection?.code,
    "invalid-batter-destination",
  );
  assert.equal(
    multiOut.attempt("record_plate_appearance", {
      batterId: "away-3",
      pitcherId: "home-1",
      result: "double_play",
      batterAdvance: { to: "out", outKind: "batter_runner" },
      runnerAdvances: threeOutMoves,
      outsOnPlay: 3,
    }).result.rejection?.code,
    "result-outs-mismatch",
  );
  multiOut.submit("record_plate_appearance", {
    batterId: "away-3",
    pitcherId: "home-1",
    result: "triple_play",
    batterAdvance: { to: "out", outKind: "batter_runner" },
    runnerAdvances: threeOutMoves,
    outsOnPlay: 3,
    fielding: { putoutBy: "home-2", triplePlay: true },
  });
  assert.equal(multiOut.ledger.state.inning.outs, 3);
  assert.equal(
    projectDiamondStats(multiOut.ledger).players["home-2"].raw.fielding.TP,
    1,
  );
  assert.deepEqual(
    replayDiamondLedger(multiOut.ledger).state,
    multiOut.ledger.state,
  );
});

test("compiled detached fielding credit stays bound to the corrected play out count", () => {
  const falseInline = harness("quick", "baseball-nfhs");
  setLineupsAndStart(falseInline, 3);
  assert.equal(
    falseInline.attempt("record_plate_appearance", {
      batterId: "away-1",
      pitcherId: "home-1",
      result: "ground_out",
      batterAdvance: { to: "out", outKind: "batter_runner" },
      runnerAdvances: [],
      outsOnPlay: 1,
      fielding: { putoutBy: "home-2", doublePlay: true },
    }).result.rejection?.code,
    "fielding-outs-mismatch",
  );

  const oneOut = harness("quick", "baseball-nfhs");
  setLineupsAndStart(oneOut, 3);
  const ordinaryOut = oneOut.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "ground_out",
    batterAdvance: { to: "out", outKind: "batter_runner" },
    runnerAdvances: [],
    outsOnPlay: 1,
  });
  assert.equal(
    oneOut.attempt("record_fielding", {
      playEventId: ordinaryOut.eventId,
      fielding: { putoutBy: "home-2", doublePlay: true },
    }).result.rejection?.code,
    "fielding-outs-mismatch",
  );

  const game = harness("quick", "baseball-nfhs");
  setLineupsAndStart(game, 3);
  game.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  const doublePlay = game.submit("record_plate_appearance", {
    batterId: "away-2",
    pitcherId: "home-1",
    result: "double_play",
    batterAdvance: { to: "out", outKind: "batter_runner" },
    runnerAdvances: [
      {
        runnerId: "away-1",
        from: "first",
        to: "out",
        cause: "force_out",
        outKind: "force",
      },
    ],
    outsOnPlay: 2,
  });
  const attachment = game.submit("record_fielding", {
    playEventId: doublePlay.eventId,
    fielding: { putoutBy: "home-2", doublePlay: true },
  });
  assert.equal(
    projectDiamondStats(game.ledger).players["home-2"].raw.fielding.DP,
    1,
  );
  assert.equal(
    game.attempt("supersede_event", {
      targetEventId: doublePlay.eventId,
      reason: "The official ruling records one out, not a double play.",
      replacement: {
        type: "record_plate_appearance",
        payload: {
          batterId: "away-2",
          pitcherId: "home-1",
          result: "ground_out",
          batterAdvance: { to: "out", outKind: "batter_runner" },
          runnerAdvances: [],
          outsOnPlay: 1,
        },
      },
    }).result.rejection?.code,
    "fielding-outs-mismatch",
  );
  game.submit("void_event", {
    targetEventId: attachment.eventId,
    reason: "Remove the incompatible double-play attachment first.",
  });
  game.submit("supersede_event", {
    targetEventId: doublePlay.eventId,
    reason: "Correct the result to the one-out official ruling.",
    replacement: {
      type: "record_plate_appearance",
      payload: {
        batterId: "away-2",
        pitcherId: "home-1",
        result: "ground_out",
        batterAdvance: { to: "out", outKind: "batter_runner" },
        runnerAdvances: [],
        outsOnPlay: 1,
      },
    },
  });
  assert.equal(
    projectDiamondStats(game.ledger).players["home-2"].raw.fielding.DP,
    0,
  );
  assert.deepEqual(replayDiamondLedger(game.ledger).state, game.ledger.state);
});

test("compiled scoring judgments follow ledger order across original and correction play identities", () => {
  const game = harness("quick", "baseball-nfhs");
  setLineupsAndStart(game, 3);
  game.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  game.submit("substitute", {
    side: "home",
    battingSlot: 1,
    outgoingPlayerId: "home-1",
    incomingPlayerId: "home-reliever",
    defensivePosition: "P",
  });
  const scoringPayload = {
    batterId: "away-2",
    pitcherId: "home-reliever",
    result: "double",
    batterAdvance: { to: "second" },
    runnerAdvances: [
      {
        runnerId: "away-1",
        from: "first",
        to: "home",
        cause: "batted_ball",
        countsRun: true,
        earned: false,
        rbi: false,
      },
    ],
    outsOnPlay: 0,
  };
  const scoringPlay = game.submit("record_plate_appearance", scoringPayload);
  game.submit("record_scoring_judgment", {
    playEventId: scoringPlay.eventId,
    runnerId: "away-1",
    responsiblePitcherId: "home-1",
    earned: false,
    rbi: false,
  });
  const correction = game.submit("supersede_event", {
    targetEventId: scoringPlay.eventId,
    reason: "Re-enter the official double under the corrected identity.",
    replacement: { type: "record_plate_appearance", payload: scoringPayload },
  });
  game.submit("record_scoring_judgment", {
    playEventId: correction.eventId,
    runnerId: "away-1",
    responsiblePitcherId: "home-reliever",
    earned: true,
    rbi: true,
  });

  let projected = projectDiamondStats(game.ledger);
  assert.equal(projected.players["home-1"].raw.pitching.R, 0);
  assert.equal(projected.players["home-reliever"].raw.pitching.R, 1);
  assert.equal(projected.players["home-reliever"].raw.pitching.ER, 1);
  assert.equal(projected.players["away-2"].raw.batting.RBI, 1);

  const latestOriginal = game.submit("record_scoring_judgment", {
    playEventId: scoringPlay.eventId,
    runnerId: "away-1",
    responsiblePitcherId: "home-1",
    earned: false,
    rbi: false,
  });
  projected = projectDiamondStats(game.ledger);
  assert.equal(projected.players["home-1"].raw.pitching.R, 1);
  assert.equal(projected.players["home-1"].raw.pitching.ER, 0);
  assert.equal(
    projected.players["home-reliever"].raw.pitching.inheritedScored,
    1,
  );
  assert.equal(projected.players["away-2"].raw.batting.RBI, 0);

  game.submit("void_event", {
    targetEventId: latestOriginal.eventId,
    reason: "Restore the effective-play judgment.",
  });
  projected = projectDiamondStats(game.ledger);
  assert.equal(projected.players["home-reliever"].raw.pitching.R, 1);
  assert.equal(projected.players["home-reliever"].raw.pitching.ER, 1);
  assert.equal(projected.players["away-2"].raw.batting.RBI, 1);
  assert.deepEqual(projectDiamondStats(game.ledger), projected);
  assert.deepEqual(replayDiamondLedger(game.ledger).state, game.ledger.state);

  const standalone = harness("quick", "baseball-nfhs");
  setLineupsAndStart(standalone, 3);
  const runnerId = placeRunnerOnBase(standalone, "third");
  const advancePayload = {
    runnerId,
    from: "third",
    to: "home",
    cause: "batted_ball",
    countsRun: true,
    earned: false,
    rbi: false,
  };
  const advance = standalone.submit("advance_runner", advancePayload);
  standalone.submit("record_scoring_judgment", {
    playEventId: advance.eventId,
    runnerId,
    earned: false,
  });
  const advanceCorrection = standalone.submit("supersede_event", {
    targetEventId: advance.eventId,
    reason: "Re-enter the advance under the corrected identity.",
    replacement: { type: "advance_runner", payload: advancePayload },
  });
  standalone.submit("record_scoring_judgment", {
    playEventId: advanceCorrection.eventId,
    runnerId,
    earned: true,
  });
  assert.equal(
    projectDiamondStats(standalone.ledger).players["home-1"].raw.pitching.ER,
    1,
  );
});

test("compiled aggregate RBI constraints preserve feasible parent history across correction and void", () => {
  const game = harness("quick", "baseball-nfhs");
  setLineupsAndStart(game, 3);
  const leadRunnerId = placeRunnerOnBase(game, "third");
  const trailRunnerId = placeRunnerOnBase(game, "second");
  const { batterId, pitcherId } = currentMatchup(game);
  const scoringPayload = {
    batterId,
    pitcherId,
    result: "double",
    batterAdvance: { to: "second" },
    runnerAdvances: [
      {
        runnerId: leadRunnerId,
        from: "third",
        to: "home",
        cause: "batted_ball",
        countsRun: true,
        earned: true,
      },
      {
        runnerId: trailRunnerId,
        from: "second",
        to: "home",
        cause: "batted_ball",
        countsRun: true,
        earned: true,
      },
    ],
    outsOnPlay: 0,
    runsBattedIn: 1,
  };
  const play = game.submit("record_plate_appearance", scoringPayload);
  const assertStableRbi = (expected) => {
    const projected = projectDiamondStats(game.ledger);
    assert.equal(projected.players[batterId].raw.batting.RBI, expected);
    assert.equal(
      projected.checkpointHash,
      createDiamondCheckpoint(game.ledger).previousHash,
    );
    assert.equal(verifyDiamondLedger(game.ledger), true);
    assert.deepEqual(replayDiamondLedger(game.ledger).state, game.ledger.state);
    assert.deepEqual(projectDiamondStats(game.ledger), projected);
  };
  assertStableRbi(1);

  game.submit("record_scoring_judgment", {
    playEventId: play.eventId,
    runnerId: leadRunnerId,
    rbi: false,
  });
  assertStableRbi(1);

  const correction = game.submit("supersede_event", {
    targetEventId: play.eventId,
    reason: "Preserve the official play under its corrected event identity.",
    replacement: { type: "record_plate_appearance", payload: scoringPayload },
  });
  const trailFalse = game.submit("record_scoring_judgment", {
    playEventId: correction.eventId,
    runnerId: trailRunnerId,
    rbi: false,
  });
  assertStableRbi(0);

  game.submit("record_scoring_judgment", {
    playEventId: play.eventId,
    runnerId: leadRunnerId,
    rbi: true,
  });
  assertStableRbi(1);

  const trailTrue = game.submit("record_scoring_judgment", {
    playEventId: correction.eventId,
    runnerId: trailRunnerId,
    rbi: true,
  });
  assertStableRbi(2);

  game.submit("void_event", {
    targetEventId: trailTrue.eventId,
    reason: "Restore the earlier false judgment for the trailing runner.",
  });
  assertStableRbi(1);
  game.submit("void_event", {
    targetEventId: trailFalse.eventId,
    reason: "Restore the original one-of-two aggregate attribution.",
  });
  assertStableRbi(1);
});

test("compiled fielding projection unions inline and detached evidence per physical play", () => {
  const game = harness("quick", "baseball-nfhs");
  setLineupsAndStart(game, 3);
  placeRunnerOnBase(game, "first");
  const playPayload = {
    batterId: "away-2",
    pitcherId: "home-1",
    result: "double_play",
    batterAdvance: { to: "out", outKind: "batter_runner" },
    runnerAdvances: [
      {
        runnerId: "away-1",
        from: "first",
        to: "out",
        cause: "force_out",
        outKind: "force",
      },
    ],
    outsOnPlay: 2,
    fielding: {
      putoutBy: "home-2",
      assists: ["home-1"],
      errors: [{ playerId: "home-1" }],
      passedBallBy: "home-2",
      doublePlay: true,
    },
  };
  const play = game.submit("record_plate_appearance", playPayload);
  const duplicateAttachment = game.submit("record_fielding", {
    playEventId: play.eventId,
    fielding: {
      putoutBy: "home-2",
      assists: ["home-1"],
      errors: [{ playerId: "home-1", kind: "throwing" }],
      passedBallBy: "home-2",
      doublePlay: true,
    },
  });
  const correction = game.submit("supersede_event", {
    targetEventId: play.eventId,
    reason:
      "Preserve the same official double play under its corrected identity.",
    replacement: { type: "record_plate_appearance", payload: playPayload },
  });
  game.submit("record_fielding", {
    playEventId: correction.eventId,
    fielding: {
      putoutBy: "home-1",
      errors: [{ playerId: "home-2", kind: "fielding" }],
      doublePlay: true,
    },
  });

  let projected = projectDiamondStats(game.ledger);
  assert.deepEqual(
    {
      PO: projected.players["home-2"].raw.fielding.PO,
      PB: projected.players["home-2"].raw.fielding.PB,
      DP: projected.players["home-2"].raw.fielding.DP,
    },
    { PO: 1, PB: 1, DP: 1 },
  );
  assert.deepEqual(
    {
      PO: projected.players["home-1"].raw.fielding.PO,
      A: projected.players["home-1"].raw.fielding.A,
      E: projected.players["home-1"].raw.fielding.E,
      DP: projected.players["home-1"].raw.fielding.DP,
    },
    { PO: 1, A: 1, E: 1, DP: 1 },
  );
  assert.deepEqual(
    {
      A: projected.players["home-2"].raw.fielding.A,
      E: projected.players["home-2"].raw.fielding.E,
      DP: projected.players["home-2"].raw.fielding.DP,
    },
    { A: 0, E: 1, DP: 1 },
  );
  assert.equal(projected.teams.home.E, 2);

  game.submit("void_event", {
    targetEventId: duplicateAttachment.eventId,
    reason: "Remove redundant fielding detail.",
  });
  projected = projectDiamondStats(game.ledger);
  assert.equal(projected.players["home-2"].raw.fielding.PO, 1);
  assert.equal(projected.players["home-1"].raw.fielding.E, 1);
  assert.equal(projected.players["home-2"].raw.fielding.E, 1);
  assert.equal(projected.teams.home.E, 2);
  assert.deepEqual(replayDiamondLedger(game.ledger).state, game.ledger.state);

  const triple = harness("quick", "baseball-nfhs");
  setLineupsAndStart(triple, 3);
  placeRunnerOnBase(triple, "first");
  triple.submit("record_plate_appearance", {
    batterId: "away-2",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [
      {
        runnerId: "away-1",
        from: "first",
        to: "second",
        cause: "batted_ball",
      },
    ],
    outsOnPlay: 0,
  });
  const triplePlay = triple.submit("record_plate_appearance", {
    batterId: "away-3",
    pitcherId: "home-1",
    result: "triple_play",
    batterAdvance: { to: "out", outKind: "batter_runner" },
    runnerAdvances: [
      {
        runnerId: "away-1",
        from: "second",
        to: "out",
        cause: "force_out",
        outKind: "force",
      },
      {
        runnerId: "away-2",
        from: "first",
        to: "out",
        cause: "force_out",
        outKind: "force",
      },
    ],
    outsOnPlay: 3,
    fielding: { putoutBy: "home-2", assists: ["home-1"], triplePlay: true },
  });
  triple.submit("record_fielding", {
    playEventId: triplePlay.eventId,
    fielding: { putoutBy: "home-2", assists: ["home-1"], triplePlay: true },
  });
  const tripleStats = projectDiamondStats(triple.ledger);
  assert.equal(tripleStats.players["home-2"].raw.fielding.TP, 1);
  assert.equal(tripleStats.players["home-1"].raw.fielding.TP, 1);

  const standalone = harness("quick", "baseball-nfhs");
  setLineupsAndStart(standalone, 3);
  const runnerId = placeRunnerOnBase(standalone, "first");
  const runnerOut = standalone.submit("advance_runner", {
    runnerId,
    from: "first",
    to: "out",
    cause: "tag_out",
    outKind: "tag",
    fielding: {
      putoutBy: "home-2",
      assists: ["home-1"],
      errors: [
        { playerId: "home-1", kind: "throwing" },
        { playerId: "home-1", kind: "throwing" },
      ],
    },
  });
  const addedDetail = standalone.submit("record_fielding", {
    playEventId: runnerOut.eventId,
    fielding: {
      putoutBy: "home-2",
      assists: ["home-1"],
      errors: [
        { playerId: "home-1", kind: "throwing" },
        { playerId: "home-1", kind: "fielding" },
        { playerId: "home-2", kind: "fielding" },
      ],
    },
  });
  let standaloneStats = projectDiamondStats(standalone.ledger);
  assert.equal(standaloneStats.players["home-2"].raw.fielding.PO, 1);
  assert.equal(standaloneStats.players["home-1"].raw.fielding.A, 1);
  assert.equal(standaloneStats.players["home-1"].raw.fielding.E, 3);
  assert.equal(standaloneStats.players["home-2"].raw.fielding.E, 1);
  assert.equal(standaloneStats.teams.home.E, 4);
  standalone.submit("void_event", {
    targetEventId: addedDetail.eventId,
    reason: "Remove the added detached fielding detail.",
  });
  standaloneStats = projectDiamondStats(standalone.ledger);
  assert.equal(standaloneStats.players["home-1"].raw.fielding.A, 1);
  assert.equal(standaloneStats.players["home-1"].raw.fielding.E, 2);
  assert.equal(standaloneStats.players["home-2"].raw.fielding.E, 0);
  assert.equal(standaloneStats.teams.home.E, 2);

  const sharedPitch = harness("quick", "baseball-nfhs");
  setLineupsAndStart(sharedPitch, 3);
  placeRunnerOnBase(sharedPitch, "first");
  sharedPitch.submit("record_plate_appearance", {
    batterId: "away-2",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [
      {
        runnerId: "away-1",
        from: "first",
        to: "second",
        cause: "batted_ball",
      },
    ],
    outsOnPlay: 0,
  });
  sharedPitch.submit("record_pitch", {
    batterId: "away-3",
    pitcherId: "home-1",
    result: "ball",
  });
  const firstAdvance = sharedPitch.submit("advance_runner", {
    runnerId: "away-1",
    from: "second",
    to: "third",
    cause: "passed_ball",
    fielding: { passedBallBy: "home-2" },
  });
  sharedPitch.submit("advance_runner", {
    runnerId: "away-2",
    from: "first",
    to: "second",
    cause: "passed_ball",
    fielding: { passedBallBy: "home-2" },
  });
  sharedPitch.submit("record_fielding", {
    playEventId: firstAdvance.eventId,
    fielding: { passedBallBy: "home-2" },
  });
  assert.equal(
    projectDiamondStats(sharedPitch.ledger).players["home-2"].raw.fielding.PB,
    1,
  );
});

test("compiled fielding projection preserves one-fielder putout multiplicity without duplicate evidence inflation", () => {
  for (const outsOnPlay of [2, 3]) {
    const game = harness("full", "baseball-nfhs");
    setLineupsAndStart(game, 3);
    placeRunnerOnBase(game, "first");
    if (outsOnPlay === 3) {
      game.submit("record_plate_appearance", {
        batterId: "away-2",
        pitcherId: "home-1",
        result: "single",
        batterAdvance: { to: "first" },
        runnerAdvances: [
          {
            runnerId: "away-1",
            from: "first",
            to: "second",
            cause: "batted_ball",
          },
        ],
        outsOnPlay: 0,
      });
    }
    game.submit("record_pitch", {
      ...currentMatchup(game),
      result: "in_play",
    });
    const matchup = currentMatchup(game);
    const fielding = {
      putoutBy: "home-2",
      ...(outsOnPlay === 2 ? { doublePlay: true } : { triplePlay: true }),
    };
    const play = game.submit("record_plate_appearance", {
      ...matchup,
      result: outsOnPlay === 2 ? "double_play" : "triple_play",
      batterAdvance: { to: "out", outKind: "batter_runner" },
      runnerAdvances:
        outsOnPlay === 2
          ? [
              {
                runnerId: "away-1",
                from: "first",
                to: "out",
                cause: "appeal_out",
                outKind: "appeal",
              },
            ]
          : [
              {
                runnerId: "away-1",
                from: "second",
                to: "out",
                cause: "appeal_out",
                outKind: "appeal",
              },
              {
                runnerId: "away-2",
                from: "first",
                to: "out",
                cause: "appeal_out",
                outKind: "appeal",
              },
            ],
      outsOnPlay,
      fielding,
    });
    const duplicate = game.submit("record_fielding", {
      playEventId: play.eventId,
      fielding,
    });
    const extra = game.submit("record_fielding", {
      playEventId: play.eventId,
      fielding,
    });

    let projected = projectDiamondStats(game.ledger);
    assert.equal(projected.players["home-2"].raw.fielding.PO, outsOnPlay);
    assert.equal(
      projected.players["home-2"].raw.fielding[outsOnPlay === 2 ? "DP" : "TP"],
      1,
    );
    assert.equal(projected.coverage.fielding, "complete");
    game.submit("void_event", {
      targetEventId: duplicate.eventId,
      reason:
        "Remove duplicate fielding evidence without changing the canonical unassisted outs.",
    });
    projected = projectDiamondStats(game.ledger);
    assert.equal(projected.players["home-2"].raw.fielding.PO, outsOnPlay);
    assert.equal(
      projected.players["home-2"].raw.fielding[outsOnPlay === 2 ? "DP" : "TP"],
      1,
    );
    game.submit("void_event", {
      targetEventId: extra.eventId,
      reason:
        "Leave only the inline unassisted fielding chain as canonical out evidence.",
    });
    projected = projectDiamondStats(game.ledger);
    assert.equal(projected.players["home-2"].raw.fielding.PO, outsOnPlay);
    assert.equal(
      projected.players["home-2"].raw.fielding[outsOnPlay === 2 ? "DP" : "TP"],
      1,
    );
    assert.equal(projected.coverage.fielding, "complete");
    assert.deepEqual(replayDiamondLedger(game.ledger).state, game.ledger.state);
  }

  const assistedIncomplete = harness("full", "baseball-nfhs");
  setLineupsAndStart(assistedIncomplete, 3);
  placeRunnerOnBase(assistedIncomplete, "first");
  assistedIncomplete.submit("record_pitch", {
    batterId: "away-2",
    pitcherId: "home-1",
    result: "in_play",
  });
  assistedIncomplete.submit("record_plate_appearance", {
    batterId: "away-2",
    pitcherId: "home-1",
    result: "double_play",
    batterAdvance: { to: "out", outKind: "batter_runner" },
    runnerAdvances: [
      {
        runnerId: "away-1",
        from: "first",
        to: "out",
        cause: "force_out",
        outKind: "force",
      },
    ],
    outsOnPlay: 2,
    fielding: {
      putoutBy: "home-2",
      assists: ["home-1"],
      doublePlay: true,
    },
  });
  const assistedStats = projectDiamondStats(assistedIncomplete.ledger);
  assert.equal(assistedStats.players["home-2"].raw.fielding.PO, 1);
  assert.equal(assistedStats.coverage.fielding, "partial");

  const twoOfThreeIncomplete = harness("full", "baseball-nfhs");
  setLineupsAndStart(twoOfThreeIncomplete, 3);
  placeRunnerOnBase(twoOfThreeIncomplete, "first");
  twoOfThreeIncomplete.submit("record_plate_appearance", {
    batterId: "away-2",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [
      {
        runnerId: "away-1",
        from: "first",
        to: "second",
        cause: "batted_ball",
      },
    ],
    outsOnPlay: 0,
  });
  twoOfThreeIncomplete.submit("record_pitch", {
    batterId: "away-3",
    pitcherId: "home-1",
    result: "in_play",
  });
  const partialTriple = twoOfThreeIncomplete.submit("record_plate_appearance", {
    batterId: "away-3",
    pitcherId: "home-1",
    result: "triple_play",
    batterAdvance: { to: "out", outKind: "batter_runner" },
    runnerAdvances: [
      {
        runnerId: "away-1",
        from: "second",
        to: "out",
        cause: "force_out",
        outKind: "force",
      },
      {
        runnerId: "away-2",
        from: "first",
        to: "out",
        cause: "force_out",
        outKind: "force",
      },
    ],
    outsOnPlay: 3,
    fielding: { putoutBy: "home-2", triplePlay: true },
  });
  twoOfThreeIncomplete.submit("record_fielding", {
    playEventId: partialTriple.eventId,
    fielding: { putoutBy: "home-1", triplePlay: true },
  });
  const partialTripleStats = projectDiamondStats(twoOfThreeIncomplete.ledger);
  assert.equal(partialTripleStats.players["home-2"].raw.fielding.PO, 1);
  assert.equal(partialTripleStats.players["home-1"].raw.fielding.PO, 1);
  assert.equal(partialTripleStats.coverage.fielding, "partial");

  const overcreditedOneOut = harness("quick", "baseball-nfhs");
  setLineupsAndStart(overcreditedOneOut, 3);
  overcreditedOneOut.submit("record_pitch", {
    ...currentMatchup(overcreditedOneOut),
    result: "in_play",
  });
  const oneOutMatchup = currentMatchup(overcreditedOneOut);
  const oneOutPlay = overcreditedOneOut.submit("record_plate_appearance", {
    ...oneOutMatchup,
    result: "ground_out",
    batterAdvance: { to: "out", outKind: "batter_runner" },
    runnerAdvances: [],
    outsOnPlay: 1,
    fielding: { putoutBy: "home-2" },
  });
  const extraOneOutPutout = overcreditedOneOut.attempt("record_fielding", {
    playEventId: oneOutPlay.eventId,
    fielding: { putoutBy: "home-1" },
  });
  assert.equal(extraOneOutPutout.result.outcome, "rejected");
  assert.equal(
    extraOneOutPutout.result.rejection?.code,
    "fielding-outs-mismatch",
  );
  assert.equal(
    projectDiamondStats(overcreditedOneOut.ledger).players["home-2"].raw
      .fielding.PO,
    1,
  );

  const overcreditedCorrection = harness("quick", "baseball-nfhs");
  setLineupsAndStart(overcreditedCorrection, 3);
  overcreditedCorrection.submit("record_pitch", {
    ...currentMatchup(overcreditedCorrection),
    result: "in_play",
  });
  const correctionMatchup = currentMatchup(overcreditedCorrection);
  const correctionSource = overcreditedCorrection.submit(
    "record_plate_appearance",
    {
      ...correctionMatchup,
      result: "ground_out",
      batterAdvance: { to: "out", outKind: "batter_runner" },
      runnerAdvances: [],
      outsOnPlay: 1,
    },
  );
  overcreditedCorrection.submit("record_fielding", {
    playEventId: correctionSource.eventId,
    fielding: { putoutBy: "home-2" },
  });
  const correctedOvercredit = overcreditedCorrection.attempt(
    "supersede_event",
    {
      targetEventId: correctionSource.eventId,
      reason:
        "A correction cannot introduce a second putout identity for one canonical out.",
      replacement: {
        type: "record_plate_appearance",
        payload: {
          ...correctionMatchup,
          result: "ground_out",
          batterAdvance: { to: "out", outKind: "batter_runner" },
          runnerAdvances: [],
          outsOnPlay: 1,
          fielding: { putoutBy: "home-1" },
        },
      },
    },
  );
  assert.equal(correctedOvercredit.result.outcome, "rejected");
  assert.equal(
    correctedOvercredit.result.rejection?.code,
    "fielding-outs-mismatch",
  );
  assert.deepEqual(
    replayDiamondLedger(overcreditedCorrection.ledger).state,
    overcreditedCorrection.ledger.state,
  );

  const boundedMultiOut = harness("full", "baseball-nfhs");
  const entries = (side) =>
    [1, 2, 3].map((index) => ({
      slot: index,
      playerId: `${side}-${String(index)}`,
    }));
  boundedMultiOut.submit("activate", {
    initialScorerUid: SCORER_UID,
    captureMode: "full",
  });
  boundedMultiOut.submit("set_lineup", {
    side: "home",
    entries: entries("home"),
  });
  boundedMultiOut.submit("set_lineup", {
    side: "away",
    entries: entries("away"),
  });
  boundedMultiOut.submit("set_defensive_alignment", {
    side: "home",
    assignments: [
      { playerId: "home-1", position: "P" },
      { playerId: "home-2", position: "C" },
      { playerId: "home-3", position: "SS" },
    ],
  });
  boundedMultiOut.submit("set_defensive_alignment", {
    side: "away",
    assignments: [
      { playerId: "away-1", position: "P" },
      { playerId: "away-2", position: "C" },
      { playerId: "away-3", position: "SS" },
    ],
  });
  boundedMultiOut.submit("start", {});
  placeRunnerOnBase(boundedMultiOut, "first");
  boundedMultiOut.submit("record_pitch", {
    ...currentMatchup(boundedMultiOut),
    result: "in_play",
  });
  const doubleMatchup = currentMatchup(boundedMultiOut);
  const doublePlay = boundedMultiOut.submit("record_plate_appearance", {
    ...doubleMatchup,
    result: "double_play",
    batterAdvance: { to: "out", outKind: "batter_runner" },
    runnerAdvances: [
      {
        runnerId: "away-1",
        from: "first",
        to: "out",
        cause: "force_out",
        outKind: "force",
      },
    ],
    outsOnPlay: 2,
    fielding: { putoutBy: "home-2", doublePlay: true },
  });
  boundedMultiOut.submit("record_fielding", {
    playEventId: doublePlay.eventId,
    fielding: { putoutBy: "home-3" },
  });
  const extraMultiOutPutout = boundedMultiOut.attempt("record_fielding", {
    playEventId: doublePlay.eventId,
    fielding: { putoutBy: "home-1" },
  });
  assert.equal(extraMultiOutPutout.result.outcome, "rejected");
  assert.equal(
    extraMultiOutPutout.result.rejection?.code,
    "fielding-outs-mismatch",
  );
  const boundedStats = projectDiamondStats(boundedMultiOut.ledger);
  assert.equal(
    boundedStats.players["home-2"].raw.fielding.PO +
      boundedStats.players["home-3"].raw.fielding.PO,
    2,
  );
  assert.equal(boundedStats.coverage.fielding, "complete");

  const noOut = harness("quick", "baseball-nfhs");
  setLineupsAndStart(noOut, 3);
  const noOutMatchup = currentMatchup(noOut);
  const inlinePutout = noOut.attempt("record_plate_appearance", {
    ...noOutMatchup,
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
    fielding: { putoutBy: "home-2" },
  });
  assert.equal(inlinePutout.result.outcome, "rejected");
  assert.equal(inlinePutout.result.rejection?.code, "fielding-outs-mismatch");
  const noOutPlay = noOut.submit("record_plate_appearance", {
    ...noOutMatchup,
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  const inlineAdvancePutout = noOut.attempt("advance_runner", {
    runnerId: noOutMatchup.batterId,
    from: "first",
    to: "second",
    cause: "stolen_base",
    fielding: { putoutBy: "home-2" },
  });
  assert.equal(inlineAdvancePutout.result.outcome, "rejected");
  assert.equal(
    inlineAdvancePutout.result.rejection?.code,
    "fielding-outs-mismatch",
  );
  const noOutAdvance = noOut.submit("advance_runner", {
    runnerId: noOutMatchup.batterId,
    from: "first",
    to: "second",
    cause: "stolen_base",
  });
  const detachedAdvancePutout = noOut.attempt("record_fielding", {
    playEventId: noOutAdvance.eventId,
    fielding: { putoutBy: "home-2" },
  });
  assert.equal(detachedAdvancePutout.result.outcome, "rejected");
  assert.equal(
    detachedAdvancePutout.result.rejection?.code,
    "fielding-outs-mismatch",
  );
  const detachedPutout = noOut.attempt("record_fielding", {
    playEventId: noOutPlay.eventId,
    fielding: { putoutBy: "home-2" },
  });
  assert.equal(detachedPutout.result.outcome, "rejected");
  assert.equal(detachedPutout.result.rejection?.code, "fielding-outs-mismatch");
  const correctionPutout = noOut.attempt("supersede_event", {
    targetEventId: noOutPlay.eventId,
    reason: "A correction cannot add a putout to a play with no actual out.",
    replacement: {
      type: "record_plate_appearance",
      payload: {
        ...noOutMatchup,
        result: "single",
        batterAdvance: { to: "first" },
        runnerAdvances: [],
        outsOnPlay: 0,
        fielding: { putoutBy: "home-2" },
      },
    },
  });
  assert.equal(correctionPutout.result.outcome, "rejected");
  assert.equal(
    correctionPutout.result.rejection?.code,
    "fielding-outs-mismatch",
  );
  noOut.submit("record_fielding", {
    playEventId: noOutPlay.eventId,
    fielding: {
      assists: ["home-1"],
      errors: [{ playerId: "home-2", kind: "fielding" }],
    },
  });
  const noOutStats = projectDiamondStats(noOut.ledger);
  assert.equal(noOutStats.players["home-2"].raw.fielding.PO, 0);
  assert.equal(noOutStats.players["home-2"].raw.fielding.E, 1);
  assert.equal(noOutStats.players["home-1"].raw.fielding.A, 1);
});

test("compiled bounded checkpoint fielding completeness stays byte-identical to full replay", () => {
  const matrix = [
    { captureMode: "full", assists: [], expectedCoverage: "complete" },
    { captureMode: "full", assists: ["home-1"], expectedCoverage: "partial" },
    { captureMode: "quick", assists: [], expectedCoverage: "partial" },
    { captureMode: "quick", assists: ["home-1"], expectedCoverage: "partial" },
  ];

  matrix.forEach(({ captureMode, assists, expectedCoverage }, index) => {
    const game = harness(captureMode, "baseball-nfhs");
    setLineupsAndStart(game, 3);
    game.submit("record_pitch", {
      ...currentMatchup(game),
      result: "in_play",
    });
    const reachMatchup = currentMatchup(game);
    game.submit("record_plate_appearance", {
      ...reachMatchup,
      result: "single",
      batterAdvance: { to: "first" },
      runnerAdvances: [],
      outsOnPlay: 0,
    });
    game.submit("record_pitch", {
      ...currentMatchup(game),
      result: "in_play",
    });
    const doubleMatchup = currentMatchup(game);
    const command = {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      commandId: uuid(900 + index),
      teamId: game.ledger.teamId,
      gameId: game.ledger.gameId,
      expectedRevision: game.ledger.state.revision,
      rulesProfileId: game.ledger.rulesProfileId,
      rulesProfileVersion: game.ledger.rulesProfileVersion,
      type: "record_plate_appearance",
      payload: {
        ...doubleMatchup,
        result: "double_play",
        batterAdvance: { to: "out", outKind: "batter_runner" },
        runnerAdvances: [
          {
            runnerId: reachMatchup.batterId,
            from: "first",
            to: "out",
            cause: "force_out",
            outKind: "force",
          },
        ],
        outsOnPlay: 2,
        fielding: {
          putoutBy: "home-2",
          ...(assists.length ? { assists } : {}),
          doublePlay: true,
        },
      },
    };
    const context = {
      actorUid: SCORER_UID,
      eventId: `checkpoint-double-play-${captureMode}-${String(index)}`,
      serverTimestampMs: 1_700_000_100_000 + index,
    };
    const checkpoint = createDiamondCheckpoint(game.ledger);
    const full = executeDiamondCommand(game.ledger, command, context);
    const bounded = executeDiamondCommandFromCheckpoint(
      checkpoint,
      command,
      context,
    );

    assert.equal(full.result.outcome, "accepted");
    assert.equal(bounded.result.outcome, "accepted");
    assert.equal(full.ledger.state.coverage.fielding, expectedCoverage);
    assert.equal(bounded.checkpoint.state.coverage.fielding, expectedCoverage);
    assert.equal(bounded.checkpoint.sequence, checkpoint.sequence + 1);
    assert.equal(bounded.checkpoint.previousHash, bounded.event.hash);
    assert.deepEqual(bounded.event, full.event);
    assert.deepEqual(replayDiamondLedger(full.ledger).state, full.ledger.state);

    const duplicate = executeDiamondCommandFromCheckpoint(
      checkpoint,
      command,
      context,
      bounded.receipt,
    );
    assert.equal(duplicate.result.outcome, "duplicate");
    assert.equal(duplicate.result.revision, full.ledger.state.revision);
    assert.deepEqual(duplicate.event, full.event);
  });
});

test("compiled GIDP credit requires explicit ground-ball evidence across checkpoints and final corrections", () => {
  const matrix = [
    {
      battedBall: "fly",
      runnerCause: "appeal_out",
      runnerOutKind: "appeal",
      expectedGidp: 0,
    },
    {
      battedBall: "line",
      runnerCause: "appeal_out",
      runnerOutKind: "appeal",
      expectedGidp: 0,
    },
    {
      battedBall: "ground",
      runnerCause: "force_out",
      runnerOutKind: "force",
      expectedGidp: 1,
    },
  ];

  matrix.forEach(
    ({ battedBall, runnerCause, runnerOutKind, expectedGidp }, index) => {
      const game = harness("full", "baseball-nfhs");
      setLineupsAndStart(game, 3);
      game.submit("record_pitch", {
        ...currentMatchup(game),
        result: "in_play",
      });
      const reachMatchup = currentMatchup(game);
      game.submit("record_plate_appearance", {
        ...reachMatchup,
        result: "single",
        batterAdvance: { to: "first" },
        runnerAdvances: [],
        outsOnPlay: 0,
      });
      game.submit("record_pitch", {
        ...currentMatchup(game),
        result: "in_play",
      });
      const doubleMatchup = currentMatchup(game);
      const command = {
        schemaVersion: DIAMOND_SCHEMA_VERSION,
        commandId: uuid(950 + index),
        teamId: game.ledger.teamId,
        gameId: game.ledger.gameId,
        expectedRevision: game.ledger.state.revision,
        rulesProfileId: game.ledger.rulesProfileId,
        rulesProfileVersion: game.ledger.rulesProfileVersion,
        type: "record_plate_appearance",
        payload: {
          ...doubleMatchup,
          result: "double_play",
          batterAdvance: { to: "out", outKind: "batter_runner" },
          runnerAdvances: [
            {
              runnerId: reachMatchup.batterId,
              from: "first",
              to: "out",
              cause: runnerCause,
              outKind: runnerOutKind,
            },
          ],
          outsOnPlay: 2,
          fielding: { putoutBy: "home-2", doublePlay: true, battedBall },
        },
      };
      const context = {
        actorUid: SCORER_UID,
        eventId: `checkpoint-gidp-${battedBall}-${String(index)}`,
        serverTimestampMs: 1_700_000_110_000 + index,
      };
      const checkpoint = createDiamondCheckpoint(game.ledger);
      const full = executeDiamondCommand(game.ledger, command, context);
      const bounded = executeDiamondCommandFromCheckpoint(
        checkpoint,
        command,
        context,
      );

      assert.equal(full.result.outcome, "accepted");
      assert.equal(bounded.result.outcome, "accepted");
      assert.deepEqual(bounded.checkpoint.state, full.ledger.state);
      assert.deepEqual(bounded.event, full.event);
      const stats = projectDiamondStats(full.ledger);
      assert.equal(
        stats.players[doubleMatchup.batterId].raw.batting.GIDP,
        expectedGidp,
      );
      assert.deepEqual(
        stats.players[doubleMatchup.batterId].sources["batting.GIDP"] ?? [],
        expectedGidp === 1 ? [full.event.eventId] : [],
      );
      assert.deepEqual(
        replayDiamondLedger(full.ledger).state,
        full.ledger.state,
      );
    },
  );

  const corrected = harness("full", "baseball-nfhs");
  setLineupsAndStart(corrected, 3);
  corrected.submit("record_pitch", {
    ...currentMatchup(corrected),
    result: "in_play",
  });
  const reachMatchup = currentMatchup(corrected);
  corrected.submit("record_plate_appearance", {
    ...reachMatchup,
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  corrected.submit("record_pitch", {
    ...currentMatchup(corrected),
    result: "in_play",
  });
  const doubleMatchup = currentMatchup(corrected);
  const groundPayload = {
    ...doubleMatchup,
    result: "double_play",
    batterAdvance: { to: "out", outKind: "batter_runner" },
    runnerAdvances: [
      {
        runnerId: reachMatchup.batterId,
        from: "first",
        to: "out",
        cause: "force_out",
        outKind: "force",
      },
    ],
    outsOnPlay: 2,
    fielding: {
      putoutBy: "home-2",
      doublePlay: true,
      battedBall: "ground",
    },
  };
  const doublePlay = corrected.submit("record_plate_appearance", groundPayload);
  corrected.submit("rules_decision", {
    code: "end_game_weather",
    description: "Weather made the current score official.",
  });
  corrected.submit("finalize", { confirmed: true });
  assert.equal(
    projectDiamondStats(corrected.ledger).players[doubleMatchup.batterId].raw
      .batting.GIDP,
    1,
  );

  corrected.submit("reopen_for_correction", {
    reason:
      "Official scorer changed the ground ball to a line-drive double play.",
  });
  const correction = corrected.submit("supersede_event", {
    targetEventId: doublePlay.eventId,
    reason: "The runner was doubled off after a caught line drive.",
    replacement: {
      type: "record_plate_appearance",
      payload: {
        ...groundPayload,
        runnerAdvances: [
          {
            runnerId: reachMatchup.batterId,
            from: "first",
            to: "out",
            cause: "appeal_out",
            outKind: "appeal",
          },
        ],
        fielding: { ...groundPayload.fielding, battedBall: "line" },
      },
    },
  });
  corrected.submit("finalize", { confirmed: true });

  const correctedStats = projectDiamondStats(corrected.ledger);
  assert.equal(corrected.ledger.state.lifecycle, "final");
  assert.equal(
    correctedStats.players[doubleMatchup.batterId].raw.batting.GIDP,
    0,
  );
  assert.deepEqual(
    correctedStats.players[doubleMatchup.batterId].sources["batting.GIDP"] ??
      [],
    [],
  );
  assert.equal(correction.supersedesEventId, doublePlay.eventId);
  assert.deepEqual(correctedStats, projectDiamondStats(corrected.ledger));
  assert.deepEqual(
    replayDiamondLedger(corrected.ledger).state,
    corrected.ledger.state,
  );
  assert.equal(verifyDiamondLedger(corrected.ledger), true);
});

test("compiled final-half LOB follows only the authoritative effective finalize", () => {
  const game = harness("quick", "baseball-nfhs");
  setLineupsAndStart(game, 3);
  const reach = game.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  game.submit("rules_decision", {
    code: "end_game_weather",
    description: "Weather made the current score official.",
  });
  game.submit("finalize", { confirmed: true });
  game.submit("private_note", { text: "Post-final audit evidence." });
  assert.equal(projectDiamondStats(game.ledger).teams.away.LOB, 1);

  game.submit("reopen_for_correction", {
    reason: "Review the final runner state.",
  });
  assert.equal(projectDiamondStats(game.ledger).teams.away.LOB, 0);
  game.submit("finalize", { confirmed: true });
  assert.equal(projectDiamondStats(game.ledger).teams.away.LOB, 1);

  game.submit("reopen_for_correction", {
    reason: "Apply the official hit correction.",
  });
  game.submit("supersede_event", {
    targetEventId: reach.eventId,
    reason: "The official scorer changed the single to a home run.",
    replacement: {
      type: "record_plate_appearance",
      payload: {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "home_run",
        batterAdvance: {
          to: "home",
          countsRun: true,
          earned: true,
          rbi: true,
        },
        runnerAdvances: [],
        outsOnPlay: 0,
        runsBattedIn: 1,
      },
    },
  });
  game.submit("finalize", { confirmed: true });
  const stats = projectDiamondStats(game.ledger);
  assert.equal(stats.teams.away.LOB, 0);
  assert.deepEqual(replayDiamondLedger(game.ledger).state, game.ledger.state);
  assert.deepEqual(projectDiamondStats(game.ledger), stats);
  assert.equal(verifyDiamondLedger(game.ledger), true);

  const cancelled = harness("quick", "baseball-nfhs");
  setLineupsAndStart(cancelled);
  cancelled.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  cancelled.submit(
    "cancel",
    { confirmed: true, reason: "The exhibition was cancelled." },
    SCORER_UID,
    { managerAuthorized: true },
  );
  assert.equal(projectDiamondStats(cancelled.ledger).teams.away.LOB, 0);
});

test("compiled LOB retains inning-ending nullified runs but rejects earlier nullification", () => {
  function prepareNullifiedForce() {
    const game = harness("quick", "baseball-nfhs");
    setLineupsAndStart(game, 6);
    const runnerOnThird = placeRunnerOnBase(game, "third");
    const runnerOnFirst = placeRunnerOnBase(game, "first");
    recordOut(game);
    recordOut(game);
    const matchup = currentMatchup(game);
    const forcePayload = {
      batterId: matchup.batterId,
      pitcherId: matchup.pitcherId,
      result: "fielders_choice",
      batterAdvance: { to: "first" },
      runnerAdvances: [
        {
          runnerId: runnerOnFirst,
          from: "first",
          to: "out",
          cause: "force_out",
          outKind: "force",
        },
        {
          runnerId: runnerOnThird,
          from: "third",
          to: "home",
          cause: "batted_ball",
          countsRun: false,
        },
      ],
      outsOnPlay: 1,
      runsBattedIn: 0,
    };
    const force = game.submit("record_plate_appearance", forcePayload);
    assert.deepEqual(game.ledger.state.bases, {
      first: {
        runnerId: matchup.batterId,
        chargedToPitcherId: matchup.pitcherId,
        courtesyForPlayerId: null,
        reachedOnEventId: force.eventId,
      },
      second: null,
      third: null,
    });
    return { game, force, forcePayload, runnerOnFirst, runnerOnThird };
  }

  const advanced = prepareNullifiedForce();
  advanced.game.submit("advance_half_inning", {});
  assert.deepEqual(
    {
      R: projectDiamondStats(advanced.game.ledger).teams.away.R,
      LOB: projectDiamondStats(advanced.game.ledger).teams.away.LOB,
    },
    { R: 0, LOB: 2 },
  );
  const advancedBundle = bundleFor(advanced.game.ledger);
  assert.equal(advancedBundle.writes.teamStats.data.stats.lob, 2);
  assert.equal(
    advancedBundle.writes.gameUpdate.diamondPublicTeamStats.stats.lob,
    2,
  );

  const finalized = prepareNullifiedForce();
  finalized.game.submit("rules_decision", {
    code: "end_game_weather",
    description: "Weather made the force-ending score official.",
  });
  finalized.game.submit("finalize", { confirmed: true });
  const originalStats = projectDiamondStats(finalized.game.ledger);
  assert.deepEqual(
    { R: originalStats.teams.away.R, LOB: originalStats.teams.away.LOB },
    { R: 0, LOB: 2 },
  );

  finalized.game.submit("reopen_for_correction", {
    reason: "The scorer reviewed whether the force was a timing play.",
  });
  assert.equal(projectDiamondStats(finalized.game.ledger).teams.away.LOB, 0);
  finalized.game.submit("supersede_event", {
    targetEventId: finalized.force.eventId,
    reason:
      "The runner was tagged after the run crossed home rather than forced out.",
    replacement: {
      type: "record_plate_appearance",
      payload: {
        ...finalized.forcePayload,
        runnerAdvances: [
          {
            runnerId: finalized.runnerOnFirst,
            from: "first",
            to: "out",
            cause: "batted_ball",
            outKind: "tag",
          },
          {
            runnerId: finalized.runnerOnThird,
            from: "third",
            to: "home",
            cause: "batted_ball",
            countsRun: true,
            earned: true,
            rbi: true,
          },
        ],
        runsBattedIn: 1,
      },
    },
  });
  finalized.game.submit("finalize", { confirmed: true });
  const correctedStats = projectDiamondStats(finalized.game.ledger);
  assert.deepEqual(
    { R: correctedStats.teams.away.R, LOB: correctedStats.teams.away.LOB },
    { R: 1, LOB: 1 },
  );
  assert.deepEqual(projectDiamondStats(finalized.game.ledger), correctedStats);
  assert.deepEqual(
    replayDiamondLedger(finalized.game.ledger).state,
    finalized.game.ledger.state,
  );
  assert.equal(verifyDiamondLedger(finalized.game.ledger), true);

  const earlierHomeRun = harness("quick", "baseball-nfhs");
  setLineupsAndStart(earlierHomeRun, 4);
  const rejectedHomeRun = earlierHomeRun.attempt("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "home_run",
    batterAdvance: { to: "home", countsRun: false },
    runnerAdvances: [],
    outsOnPlay: 0,
    runsBattedIn: 0,
  });
  assert.equal(rejectedHomeRun.result.outcome, "rejected");
  assert.equal(
    rejectedHomeRun.result.rejection?.code,
    "run-nullification-requires-third-out",
  );

  const earlier = harness("quick", "baseball-nfhs");
  setLineupsAndStart(earlier, 4);
  const earlierRunner = placeRunnerOnBase(earlier, "third");
  const earlierRevision = earlier.ledger.state.revision;
  const rejected = earlier.attempt("advance_runner", {
    runnerId: earlierRunner,
    from: "third",
    to: "home",
    cause: "batted_ball",
    countsRun: false,
  });
  assert.equal(rejected.result.outcome, "rejected");
  assert.equal(
    rejected.result.rejection?.code,
    "run-nullification-requires-third-out",
  );
  assert.equal(rejected.ledger.state.revision, earlierRevision);
  assert.deepEqual(
    replayDiamondLedger(earlier.ledger).state,
    earlier.ledger.state,
  );
});

test("compiled ready-state forfeit blocks setup and start mutations but remains finalizable", () => {
  const game = harness("quick", "fastpitch-nfhs");
  game.submit("activate", {
    initialScorerUid: SCORER_UID,
    captureMode: "quick",
  });
  game.submit("rules_decision", {
    code: "end_game_forfeit_away",
    description: "The umpire awarded the ready game to the away team.",
  });
  const blocked = [
    {
      type: "set_lineup",
      eventId: "compiled-post-forfeit-lineup",
      payload: {
        side: "home",
        entries: [{ slot: 1, playerId: "home-1" }],
      },
    },
    {
      type: "set_dp_flex",
      eventId: "compiled-post-forfeit-dp-flex",
      payload: {
        side: "home",
        dpPlayerId: "home-1",
        flexPlayerId: "home-flex",
        dpBattingSlot: 1,
        flexDefensivePosition: "RF",
      },
    },
    {
      type: "start",
      eventId: "compiled-post-forfeit-start",
      payload: {},
    },
  ];
  for (const action of blocked) {
    assert.throws(
      () => reduceDiamondEvent(game.ledger.state, action),
      (error) => error?.code === "game-end-decision-recorded",
    );
  }
  game.submit("finalize", { confirmed: true });
  assert.equal(game.ledger.state.lifecycle, "final");
  assert.equal(game.ledger.state.finalizationReason.kind, "forfeit");
  assert.equal(verifyDiamondLedger(game.ledger), true);
  assert.deepEqual(replayDiamondLedger(game.ledger).state, game.ledger.state);
});

test("compiled replay carries an omitted tiebreaker charge through a relief appearance without inferring earned status", () => {
  const game = harness("quick", "fastpitch-nfhs");
  setLineupsAndStart(game);
  advanceToHalf(game, 8, "top");
  const awayOrder = game.ledger.state.lineups.away.battingOrder;
  const previousAwayBatter =
    awayOrder[
      (game.ledger.state.nextBatterSlot.away - 1 + awayOrder.length) %
        awayOrder.length
    ].activePlayerId;
  game.submit("place_tiebreaker_runner", {
    side: "away",
    runnerId: previousAwayBatter,
    base: "second",
  });
  assert.equal(game.ledger.state.bases.second.chargedToPitcherId, "home-1");
  game.submit("substitute", {
    side: "home",
    battingSlot: 1,
    outgoingPlayerId: "home-1",
    incomingPlayerId: "home-reliever",
    defensivePosition: "P",
  });
  game.submit("advance_runner", {
    runnerId: previousAwayBatter,
    from: "second",
    to: "home",
    cause: "batted_ball",
    countsRun: true,
    earned: false,
  });

  const stats = projectDiamondStats(game.ledger);
  assert.deepEqual(
    {
      R: stats.players["home-1"].raw.pitching.R,
      ER: stats.players["home-1"].raw.pitching.ER,
    },
    { R: 1, ER: 0 },
  );
  assert.deepEqual(
    {
      APP: stats.players["home-reliever"].raw.pitching.APP,
      GS: stats.players["home-reliever"].raw.pitching.GS,
      inheritedRunners:
        stats.players["home-reliever"].raw.pitching.inheritedRunners,
      inheritedScored:
        stats.players["home-reliever"].raw.pitching.inheritedScored,
    },
    { APP: 1, GS: 0, inheritedRunners: 1, inheritedScored: 1 },
  );
  assert.equal(verifyDiamondLedger(game.ledger), true);
  assert.deepEqual(replayDiamondLedger(game.ledger).state, game.ledger.state);
});

test("compiled stats project active pitcher alignment entries once and preserve inherited-run attribution on replay", () => {
  const game = harness("quick");
  setLineupsAndStart(game);
  game.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  const alignment = {
    side: "home",
    assignments: [
      { playerId: "home-2", position: "P" },
      { playerId: "home-1", position: "C" },
    ],
  };
  game.submit("set_defensive_alignment", alignment);
  game.submit("set_defensive_alignment", alignment);
  game.submit("advance_runner", {
    runnerId: "away-1",
    from: "first",
    to: "home",
    cause: "batted_ball",
    countsRun: true,
    earned: false,
  });

  const stats = projectDiamondStats(game.ledger);
  assert.deepEqual(
    {
      APP: stats.players["home-2"].raw.pitching.APP,
      GS: stats.players["home-2"].raw.pitching.GS,
      inheritedRunners: stats.players["home-2"].raw.pitching.inheritedRunners,
      inheritedScored: stats.players["home-2"].raw.pitching.inheritedScored,
    },
    { APP: 1, GS: 0, inheritedRunners: 1, inheritedScored: 1 },
  );
  assert.deepEqual(
    {
      R: stats.players["home-1"].raw.pitching.R,
      ER: stats.players["home-1"].raw.pitching.ER,
    },
    { R: 1, ER: 0 },
  );
  assert.equal(verifyDiamondLedger(game.ledger), true);
  assert.deepEqual(replayDiamondLedger(game.ledger).state, game.ledger.state);
  assert.deepEqual(projectDiamondStats(game.ledger), stats);
});

test("compiled stats exclude non-entry pitcher changes and every roster mutation closes at game end", () => {
  const offensive = harness("quick");
  setLineupsAndStart(offensive);
  const officialPlay = offensive.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  offensive.submit("set_defensive_alignment", {
    side: "away",
    assignments: [
      { playerId: "away-2", position: "P" },
      { playerId: "away-1", position: "C" },
    ],
  });
  offensive.submit("substitute", {
    side: "away",
    battingSlot: 2,
    outgoingPlayerId: "away-2",
    incomingPlayerId: "away-planned-pitcher",
    defensivePosition: "P",
  });
  offensive.submit("re_enter", {
    side: "away",
    battingSlot: 2,
    starterPlayerId: "away-2",
    replacedPlayerId: "away-planned-pitcher",
    defensivePosition: "P",
  });
  offensive.submit("rules_decision", {
    code: "end_game_weather",
    description: "The game ended before the batting team fielded again.",
  });
  const offensiveStats = projectDiamondStats(offensive.ledger);
  assert.deepEqual(
    {
      G: offensiveStats.players["away-planned-pitcher"].raw.batting.G,
      APP: offensiveStats.players["away-planned-pitcher"].raw.pitching.APP,
      inheritedRunners:
        offensiveStats.players["away-planned-pitcher"].raw.pitching
          .inheritedRunners,
    },
    { G: 1, APP: 0, inheritedRunners: 0 },
  );
  assert.deepEqual(
    {
      APP: offensiveStats.players["away-2"].raw.pitching.APP,
      inheritedRunners:
        offensiveStats.players["away-2"].raw.pitching.inheritedRunners,
    },
    { APP: 0, inheritedRunners: 0 },
  );

  const blockedActions = [
    {
      type: "set_defensive_alignment",
      eventId: "compiled-post-decision-alignment",
      payload: {
        side: "home",
        assignments: [
          { playerId: "home-2", position: "P" },
          { playerId: "home-1", position: "C" },
        ],
      },
    },
    {
      type: "substitute",
      eventId: "compiled-post-decision-substitution",
      payload: {
        side: "home",
        battingSlot: 1,
        outgoingPlayerId: "home-1",
        incomingPlayerId: "home-reliever",
        defensivePosition: "P",
      },
    },
    {
      type: "re_enter",
      eventId: "compiled-post-decision-reentry",
      payload: {
        side: "home",
        battingSlot: 1,
        starterPlayerId: "home-1",
        replacedPlayerId: "home-reliever",
        defensivePosition: "P",
      },
    },
    {
      type: "add_courtesy_runner",
      eventId: "compiled-post-decision-courtesy",
      payload: {
        side: "away",
        forPlayerId: "away-1",
        runnerId: "away-courtesy",
        base: "first",
        forRole: "pitcher",
      },
    },
    {
      type: "suspend",
      eventId: "compiled-post-decision-suspend",
      payload: { reason: "Do not suspend a decided game." },
    },
  ];
  for (const action of blockedActions) {
    assert.throws(
      () => reduceDiamondEvent(offensive.ledger.state, action),
      (error) => error?.code === "game-end-decision-recorded",
    );
  }
  assert.throws(
    () =>
      reduceDiamondEvent(
        {
          ...offensive.ledger.state,
          lifecycle: "suspended",
          suspendedReason: "Delay before the final ruling.",
        },
        {
          type: "resume",
          eventId: "compiled-post-decision-resume",
          payload: {},
        },
      ),
    (error) => error?.code === "game-end-decision-recorded",
  );
  offensive.submit("record_fielding", {
    playEventId: officialPlay.eventId,
    fielding: { errors: [{ playerId: "home-2", kind: "fielding" }] },
  });

  const closedHalf = harness("quick");
  setLineupsAndStart(closedHalf);
  closedHalf.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "single",
    batterAdvance: { to: "first" },
    runnerAdvances: [],
    outsOnPlay: 0,
  });
  closedHalf.submit("add_courtesy_runner", {
    side: "away",
    forPlayerId: "away-1",
    runnerId: "away-stranded-runner",
    base: "first",
    forRole: "pitcher",
  });
  recordOut(closedHalf);
  recordOut(closedHalf);
  recordOut(closedHalf);
  assert.throws(
    () =>
      reduceDiamondEvent(closedHalf.ledger.state, {
        type: "add_courtesy_runner",
        eventId: "compiled-closed-half-courtesy",
        payload: {
          side: "away",
          forPlayerId: "away-1",
          runnerId: "away-second-courtesy",
          base: "first",
          forRole: "pitcher",
        },
      }),
    (error) => error?.code === "half-inning-complete",
  );
  const closedMatchup = currentMatchup(closedHalf);
  assert.throws(
    () =>
      reduceDiamondEvent(closedHalf.ledger.state, {
        type: "record_pitch",
        eventId: "compiled-closed-half-pitch",
        payload: {
          batterId: closedMatchup.batterId,
          pitcherId: closedMatchup.pitcherId,
          result: "in_play",
        },
      }),
    (error) => error?.code === "half-inning-complete",
  );
  assert.throws(
    () =>
      reduceDiamondEvent(closedHalf.ledger.state, {
        type: "advance_runner",
        eventId: "compiled-closed-half-runner-advance",
        payload: {
          runnerId: "away-stranded-runner",
          from: "first",
          to: "home",
          cause: "other",
          countsRun: true,
          earned: false,
          rbi: false,
        },
      }),
    (error) => error?.code === "half-inning-complete",
  );
  closedHalf.submit("set_defensive_alignment", {
    side: "home",
    assignments: [
      { playerId: "home-2", position: "P" },
      { playerId: "home-1", position: "C" },
    ],
  });
  assert.deepEqual(
    {
      APP: projectDiamondStats(closedHalf.ledger).players["home-2"].raw.pitching
        .APP,
      inheritedRunners: projectDiamondStats(closedHalf.ledger).players["home-2"]
        .raw.pitching.inheritedRunners,
    },
    { APP: 0, inheritedRunners: 0 },
  );

  const automaticFinalState = {
    ...closedHalf.ledger.state,
    inning: {
      number: 7,
      half: "bottom",
      outs: 3,
      balls: 0,
      strikes: 0,
      pitchesInPlateAppearance: 0,
      lastPitchResult: null,
    },
    score: { home: 1, away: 0 },
    halfInningEnd: null,
  };
  for (const action of blockedActions) {
    assert.throws(
      () => reduceDiamondEvent(automaticFinalState, action),
      (error) => error?.code === "game-ending-condition-met",
    );
  }
  assert.throws(
    () =>
      reduceDiamondEvent(
        {
          ...automaticFinalState,
          lifecycle: "suspended",
          suspendedReason: "Delay after the final out.",
        },
        {
          type: "resume",
          eventId: "compiled-post-regulation-resume",
          payload: {},
        },
      ),
    (error) => error?.code === "game-ending-condition-met",
  );
  assert.equal(verifyDiamondLedger(offensive.ledger), true);
  assert.deepEqual(
    replayDiamondLedger(offensive.ledger).state,
    offensive.ledger.state,
  );
});

test("compiled active alignment rejects a pending run-limit decision without crediting a pitching entry", () => {
  const game = harness("quick", "baseball-youth");
  setLineupsAndStart(game);
  for (let run = 0; run < 5; run += 1) {
    const { batterId, pitcherId } = currentMatchup(game);
    game.submit("record_plate_appearance", {
      batterId,
      pitcherId,
      result: "home_run",
      batterAdvance: {
        to: "home",
        cause: "batted_ball",
        countsRun: true,
        earned: true,
        rbi: true,
      },
      runnerAdvances: [],
      outsOnPlay: 0,
      runsBattedIn: 1,
    });
  }
  assert.equal(game.ledger.state.inningRuns.T1, 5);
  assert.throws(
    () =>
      reduceDiamondEvent(game.ledger.state, {
        type: "set_defensive_alignment",
        eventId: "compiled-run-limit-alignment",
        payload: {
          side: "home",
          assignments: [
            { playerId: "home-2", position: "P" },
            { playerId: "home-1", position: "C" },
          ],
        },
      }),
    (error) => error?.code === "run-limit-decision-required",
  );
  assert.equal(
    projectDiamondStats(game.ledger).players["home-2"].raw.pitching.APP,
    0,
  );
  game.submit("rules_decision", {
    code: "end_half_inning_run_limit",
    description: "The scorer confirms the five-run inning limit.",
  });
  assert.equal(verifyDiamondLedger(game.ledger), true);
  assert.deepEqual(replayDiamondLedger(game.ledger).state, game.ledger.state);
});

test("completed public projection preserves the current matchup without exposing roster details", () => {
  const configuredProjection = bundleFor(harness("full").ledger).writes
    .publicCurrent.data;
  assert.equal(configuredProjection.currentBatter, null);
  assert.equal(configuredProjection.currentPitcher, null);

  const game = harness("full");
  setLineupsAndStart(game);
  addHomeRun(game);
  const privateRosterDetail = "private medical detail";
  const bundle = bundleFor(game.ledger, {
    playerDirectory: {
      ...DIRECTORY,
      "away-1": {
        ...DIRECTORY["away-1"],
        medicalInfo: privateRosterDetail,
      },
      "home-1": {
        ...DIRECTORY["home-1"],
        contactEmail: "private@example.test",
      },
    },
  });
  const projection = bundle.writes.publicCurrent.data;

  assert.deepEqual(projection.currentBatter, {
    playerId: "away-2",
    name: "Bailey Away",
    number: "12",
  });
  assert.deepEqual(projection.currentPitcher, {
    playerId: "home-1",
    name: "Casey Home",
    number: "21",
  });
  assert.doesNotMatch(
    JSON.stringify(projection),
    /medicalInfo|contactEmail|private medical detail|private@example\.test/,
  );
});

test("full capture creates compatible additive stat documents with source play evidence", () => {
  const { game, homeRun } = buildFullGameWithPrivateData();
  const bundle = bundleFor(game.ledger);
  assert.deepEqual(bundle, bundleFor(game.ledger));
  const batter = playerWrite(bundle, "away-1");

  assert.equal(bundle.trackingEngine, "diamond-v2");
  assert.equal(bundle.sourceRevision, game.ledger.state.revision);
  assert.equal(bundle.checkpointHash, game.ledger.state.checkpointHash);
  assert.equal(batter.schemaVersion, 1);
  assert.equal(batter.playerId, "away-1");
  assert.deepEqual(
    batter.publicStatIds,
    [...ALL_PUBLIC_PLAYER_STAT_IDS].sort(),
  );
  assert.equal(
    bundle.writes.privateCurrent.relativePath,
    "diamondScorebooks/v2/projections/current",
  );
  assert.equal(bundle.writes.publicCurrent.relativePath, "diamondPublic/state");
  assert.equal(
    bundle.writes.publicReplayManifest.relativePath,
    "diamondPublic/replay",
  );
  assert.deepEqual(
    {
      ab: batter.stats.ab,
      h: batter.stats.h,
      hr: batter.stats.hr,
      r: batter.stats.r,
      rbi: batter.stats.rbi,
    },
    { ab: 1, h: 1, hr: 1, r: 1, rbi: 1 },
  );
  assert.equal(batter.derivedStats.avg, 1);
  assert.equal(batter.derivedStats.obp, 1);
  assert.equal(
    Object.hasOwn(batter.stats, "avg"),
    false,
    "rate stats must not be season-summed",
  );
  assert.deepEqual(batter.statSources.hr, [homeRun.eventId]);
  assert.ok(batter.sourcePlayIds.includes(homeRun.eventId));
  assert.equal(batter.coverage.batting, "complete");
  assert.equal(bundle.writes.teamStats.data.stats.r, 1);
  assert.equal(bundle.writes.teamStats.data.stats.h, 1);
  assert.equal(bundle.writes.teamStats.data.trackingEngine, "diamond-v2");
  assert.deepEqual(
    bundle.writes.gameUpdate.diamondPublicTeamStats.publicStatIds,
    [...ALL_PUBLIC_TEAM_STAT_IDS].sort(),
  );
  assert.equal(bundle.writes.gameUpdate.diamondPublicTeamStats.stats.r, 1);
  assert.equal(
    bundle.writes.gameUpdate.diamondPublicTeamStats.sourceRevision,
    game.ledger.state.revision,
  );
});

test("only explicitly public configured stats enter public player or opponent projections", () => {
  const { game } = buildFullGameWithPrivateData();
  const publicPlayerStatIds = ALL_PUBLIC_PLAYER_STAT_IDS.filter(
    (statId) => statId !== "hr" && statId !== "avg",
  );
  const bundle = bundleFor(game.ledger, {
    publicPlayerStatIds,
  });
  const publicBatter = playerWrite(bundle, "away-1");
  const privateBatter = bundle.writes.privatePlayerStats.find(
    (write) => write.playerId === "away-1",
  ).data;
  assert.equal(Object.hasOwn(publicBatter.stats, "hr"), false);
  assert.equal(Object.hasOwn(publicBatter.derivedStats, "avg"), false);
  assert.equal(Object.hasOwn(publicBatter.statCoverage, "hr"), false);
  assert.equal(Object.hasOwn(publicBatter.statSources, "hr"), false);
  assert.equal(privateBatter.stats.hr, 1);
  assert.equal(privateBatter.derivedStats.avg, 1);
  assert.equal(privateBatter.statCoverage.hr, "complete");

  const opponent = buildDiamondProjectionBundle({
    ledger: game.ledger,
    instanceId: INSTANCE_ID,
    orientationSnapshot: orientationFor("home"),
    playerDirectory: DIRECTORY,
    publicPlayerStatIds,
    publicTeamStatIds: ALL_PUBLIC_TEAM_STAT_IDS,
  }).writes.gameUpdate.opponentStats["away-1"];
  assert.equal(Object.hasOwn(opponent, "hr"), false);
  assert.equal(Object.hasOwn(opponent, "avg"), false);
});

test("catalog metrics omitted from the pinned config stay manager-private by default", () => {
  const { game } = buildFullGameWithPrivateData();
  const bundle = bundleFor(game.ledger, {
    publicPlayerStatIds: ["ab", "h"],
    publicTeamStatIds: ["r"],
  });
  const publicBatter = playerWrite(bundle, "away-1");
  const privateBatter = bundle.writes.privatePlayerStats.find(
    (write) => write.playerId === "away-1",
  ).data;

  assert.deepEqual(publicBatter.stats, { ab: 1, h: 1 });
  assert.equal(Object.hasOwn(publicBatter.stats, "hr"), false);
  assert.equal(Object.hasOwn(publicBatter.statCoverage, "hr"), false);
  assert.equal(Object.hasOwn(publicBatter.statSources, "hr"), false);
  assert.equal(privateBatter.stats.hr, 1);
  assert.equal(privateBatter.statCoverage.hr, "complete");
  assert.equal(bundle.writes.gameUpdate.opponentStats["home-1"].p_h, undefined);
  assert.deepEqual(
    bundle.writes.gameUpdate.diamondPublicTeamStats.publicStatIds,
    ["r"],
  );
  assert.deepEqual(bundle.writes.gameUpdate.diamondPublicTeamStats.stats, {
    r: 1,
  });
  assert.deepEqual(
    bundle.writes.gameUpdate.diamondPublicTeamStats.statCoverage,
    { r: "complete" },
  );
  assert.equal(
    Object.hasOwn(bundle.writes.gameUpdate.diamondPublicTeamStats.stats, "h"),
    false,
  );
  assert.equal(
    Object.hasOwn(
      bundle.writes.gameUpdate.diamondPublicTeamStats.observedStats,
      "h",
    ),
    false,
  );
  assert.equal(
    Object.hasOwn(
      bundle.writes.gameUpdate.diamondPublicTeamStats.statCoverage,
      "h",
    ),
    false,
  );
  assert.equal(bundle.writes.teamStats.data.stats.h, 1);
});

test("public team stat serializer requires one exact projection head and never broadens its allowlist", () => {
  const { game } = buildFullGameWithPrivateData();
  const bundle = bundleFor(game.ledger, { publicTeamStatIds: ["h", "r"] });
  const instanceId = uuid(900);
  const configHash = `sha256:${"b".repeat(64)}`;
  const projectionHash = `sha256:${"c".repeat(64)}`;
  const projectedGame = {
    id: "game-1",
    teamId: "team-away",
    trackingEngine: "diamond-v2",
    diamondProjectionStatus: "current",
    diamondProjectionComplete: true,
    diamondScorebookInstanceId: instanceId,
    diamondProjectionRevision: game.ledger.state.revision,
    diamondProjectionCheckpointHash: game.ledger.state.checkpointHash,
    diamondStatConfigSnapshotHash: configHash,
    diamondProjectionHash: projectionHash,
    diamondPublicTeamStats: {
      ...bundle.writes.gameUpdate.diamondPublicTeamStats,
      teamId: "team-away",
      diamondGameId: "game-1",
      instanceId,
      diamondScorebookInstanceId: instanceId,
      projectionGeneration: instanceId,
      statConfigSnapshotHash: configHash,
      projectionHash,
    },
  };

  assert.deepEqual(
    getDiamondPublicProjectionHead(projectedGame, {
      teamId: "team-away",
      gameId: "game-1",
    }),
    {
      teamId: "team-away",
      gameId: "game-1",
      instanceId,
      sourceRevision: game.ledger.state.revision,
      checkpointHash: game.ledger.state.checkpointHash,
      statConfigSnapshotHash: configHash,
      projectionHash,
    },
  );
  const publicOnly = sanitizeDiamondPublicTeamStatDocument({
    game: projectedGame,
    teamId: "team-away",
    gameId: "game-1",
    allowedStatIds: ["r"],
  });
  assert.deepEqual(publicOnly.publicStatIds, ["r"]);
  assert.deepEqual(publicOnly.stats, { r: 1 });
  assert.equal(Object.hasOwn(publicOnly.stats, "h"), false);
  const response = serializeDiamondPublicStatsResponse({
    game: projectedGame,
    teamId: "team-away",
    gameId: "game-1",
  });
  assert.deepEqual(response, {
    schemaVersion: 1,
    trackingEngine: "diamond-v2",
    status: "complete",
    complete: true,
    instanceId,
    sourceRevision: game.ledger.state.revision,
    checkpointHash: game.ledger.state.checkpointHash,
    statConfigSnapshotHash: configHash,
    projectionHash,
    publicTeamStats: projectedGame.diamondPublicTeamStats,
  });

  for (const mutation of [
    { projectionHash: `sha256:${"d".repeat(64)}` },
    { sourceRevision: game.ledger.state.revision - 1 },
    { privateNote: "must-never-pass" },
  ]) {
    assert.equal(
      sanitizeDiamondPublicTeamStatDocument({
        game: {
          ...projectedGame,
          diamondPublicTeamStats: {
            ...projectedGame.diamondPublicTeamStats,
            ...mutation,
          },
        },
        teamId: "team-away",
        gameId: "game-1",
      }),
      null,
    );
    assert.deepEqual(
      serializeDiamondPublicStatsResponse({
        game: {
          ...projectedGame,
          diamondPublicTeamStats: {
            ...projectedGame.diamondPublicTeamStats,
            ...mutation,
          },
        },
        teamId: "team-away",
        gameId: "game-1",
      }),
      {
        schemaVersion: 1,
        trackingEngine: "diamond-v2",
        status: "partial",
        complete: false,
      },
    );
  }
});

test("full capture with no terminal pitch evidence marks only pitch-count stats partial", () => {
  const game = harness("full");
  setLineupsAndStart(game);
  addHomeRun(game, { pitch: false });
  const bundle = buildDiamondProjectionBundle({
    ledger: game.ledger,
    instanceId: INSTANCE_ID,
    orientationSnapshot: orientationFor("home"),
    playerDirectory: DIRECTORY,
    publicPlayerStatIds: ALL_PUBLIC_PLAYER_STAT_IDS,
    publicTeamStatIds: ALL_PUBLIC_TEAM_STAT_IDS,
  });
  const pitcher = playerWrite(bundle, "home-1");

  assert.equal(pitcher.coverage.pitching, "complete");
  assert.equal(pitcher.coverage.pitches, "partial");
  assert.equal(pitcher.statCoverage.p_h, "complete");
  assert.equal(pitcher.stats.p_h, 1);
  assert.equal(pitcher.statCoverage.pitches, "partial");
  assert.equal(pitcher.statCoverage.strikes, "partial");
  assert.equal(pitcher.statCoverage.strike_rate, "partial");
  assert.equal(Object.hasOwn(pitcher.stats, "pitches"), false);
  assert.equal(Object.hasOwn(pitcher.observedStats, "pitches"), false);
});

test("quick capture omits uncollected zeroes and labels partial observations", () => {
  const game = harness("quick");
  setLineupsAndStart(game);
  const homeRun = addHomeRun(game, { pitch: false });
  const bundle = bundleFor(game.ledger);
  const batter = playerWrite(bundle, "away-1");

  assert.equal(batter.coverage.fielding, "not_collected");
  assert.equal(batter.coverage.pitching, "partial");
  assert.equal(batter.statCoverage.e, "not_collected");
  assert.equal(batter.statCoverage.pitches, "not_collected");
  assert.equal(Object.hasOwn(batter.stats, "e"), false);
  assert.equal(Object.hasOwn(batter.observedStats, "e"), false);
  assert.equal(Object.hasOwn(batter.stats, "pitches"), false);
  assert.equal(Object.hasOwn(batter.observedStats, "pitches"), false);
  assert.equal(
    Object.hasOwn(batter.observedDerivedStats, "innings_pitched"),
    false,
  );
  assert.equal(Object.hasOwn(batter.observedDerivedStats, "chances"), false);
  assert.equal(bundle.writes.teamStats.data.statCoverage.e, "not_collected");
  assert.equal(Object.hasOwn(bundle.writes.teamStats.data.stats, "e"), false);
  assert.equal(
    Object.hasOwn(bundle.writes.teamStats.data.observedStats, "e"),
    false,
  );
  assert.deepEqual(batter.statSources.hr, [homeRun.eventId]);
  assert.equal(bundle.writes.publicCurrent.data.completeness.status, "partial");
  assert.equal(
    bundle.writes.publicCurrent.data.completeness.authoritativeRevision,
    game.ledger.state.revision,
  );
  assert.equal(
    bundle.writes.publicCurrent.data.completeness.families.fielding,
    "not_collected",
  );
  assert.equal(bundle.writes.gameUpdate.opponentStats["home-1"].p_h, 1);
  assert.equal(
    bundle.writes.gameUpdate.opponentStats["home-1"].diamondCoverage.pitching,
    "partial",
  );
});

test("zero denominators stay unavailable and innings pitched remain outs-backed", () => {
  const game = harness("full");
  setLineupsAndStart(game);
  const documents = buildDiamondStatDocuments({
    ledger: game.ledger,
    orientationSnapshot: orientationFor("home"),
    playerDirectory: DIRECTORY,
    publicPlayerStatIds: ALL_PUBLIC_PLAYER_STAT_IDS,
    publicTeamStatIds: ALL_PUBLIC_TEAM_STAT_IDS,
  });
  const pitcher = documents.publicPlayerStatsWrites.find(
    (write) => write.playerId === "home-1",
  ).data;

  assert.equal(pitcher.stats.ip_outs, 0);
  assert.equal(pitcher.derivedStats.innings_pitched, "0.0");
  assert.equal(Object.hasOwn(pitcher.derivedStats, "era"), false);
  assert.equal(Object.hasOwn(pitcher.derivedStats, "whip"), false);
  assert.ok(pitcher.unavailableDerivedStats.includes("era"));
  assert.ok(pitcher.unavailableDerivedStats.includes("whip"));
  assert.ok(pitcher.unavailableDerivedStats.includes("strike_rate"));
  assert.equal(pitcher.statCoverage.w, "not_collected");
  assert.equal(pitcher.statCoverage.l, "not_collected");
  assert.equal(pitcher.statCoverage.sv, "not_collected");
  assert.equal(Object.hasOwn(pitcher.stats, "w"), false);
  assert.equal(Object.hasOwn(pitcher.stats, "l"), false);
  assert.equal(Object.hasOwn(pitcher.stats, "sv"), false);
});

test("pitcher decisions become complete only after explicit final win and loss judgments", () => {
  const game = harness("full");
  setLineupsAndStart(game);
  const scoringPlay = addHomeRun(game);
  const recordGroundOut = () => {
    const battingSide =
      game.ledger.state.inning.half === "top" ? "away" : "home";
    const fieldingSide = battingSide === "away" ? "home" : "away";
    const order = game.ledger.state.lineups[battingSide].battingOrder;
    const batterId =
      order[game.ledger.state.nextBatterSlot[battingSide]].activePlayerId;
    const defense = game.ledger.state.lineups[fieldingSide].defense;
    const pitcherId = defense.P;
    game.submit("record_pitch", { batterId, pitcherId, result: "in_play" });
    return game.submit("record_plate_appearance", {
      batterId,
      pitcherId,
      result: "ground_out",
      batterAdvance: { to: "out", outKind: "batter_runner" },
      runnerAdvances: [],
      outsOnPlay: 1,
      fielding: {
        putoutBy: defense.C,
        assists: [],
        battedBall: "ground",
      },
    });
  };
  recordGroundOut();
  recordGroundOut();
  recordGroundOut();
  game.submit("advance_half_inning", {});
  const awayPitcherPlay = recordGroundOut();
  game.submit("record_scoring_judgment", {
    playEventId: awayPitcherPlay.eventId,
    pitcherOfRecord: { side: "away", playerId: "away-1", decision: "win" },
  });
  game.submit("record_scoring_judgment", {
    playEventId: scoringPlay.eventId,
    pitcherOfRecord: { side: "home", playerId: "home-1", decision: "loss" },
  });
  let documents = buildDiamondStatDocuments({
    ledger: game.ledger,
    orientationSnapshot: orientationFor("home"),
    playerDirectory: DIRECTORY,
    publicPlayerStatIds: ALL_PUBLIC_PLAYER_STAT_IDS,
    publicTeamStatIds: ALL_PUBLIC_TEAM_STAT_IDS,
  });
  let homePitcher = documents.publicPlayerStatsWrites.find(
    (write) => write.playerId === "home-1",
  ).data;
  assert.equal(
    projectDiamondStats(game.ledger).players["home-1"].raw.pitching.L,
    0,
  );
  assert.equal(homePitcher.statCoverage.w, "not_collected");
  assert.equal(homePitcher.statCoverage.l, "not_collected");
  assert.equal(Object.hasOwn(homePitcher.stats, "l"), false);
  game.submit("rules_decision", {
    code: "end_game_weather",
    description: "The umpire declared the game official.",
  });
  game.submit("finalize", { confirmed: true });

  documents = buildDiamondStatDocuments({
    ledger: game.ledger,
    orientationSnapshot: orientationFor("home"),
    playerDirectory: DIRECTORY,
    publicPlayerStatIds: ALL_PUBLIC_PLAYER_STAT_IDS,
    publicTeamStatIds: ALL_PUBLIC_TEAM_STAT_IDS,
  });
  homePitcher = documents.publicPlayerStatsWrites.find(
    (write) => write.playerId === "home-1",
  ).data;

  assert.equal(homePitcher.statCoverage.w, "complete");
  assert.equal(homePitcher.stats.w, 0);
  assert.equal(homePitcher.stats.l, 1);
  assert.equal(homePitcher.stats.sv, 0);
  assert.equal(documents.opponentStats["away-1"].w, 1);

  game.submit("reopen_for_correction", {
    reason: "Review the official pitcher decision.",
  });
  documents = buildDiamondStatDocuments({
    ledger: game.ledger,
    orientationSnapshot: orientationFor("home"),
    playerDirectory: DIRECTORY,
    publicPlayerStatIds: ALL_PUBLIC_PLAYER_STAT_IDS,
    publicTeamStatIds: ALL_PUBLIC_TEAM_STAT_IDS,
  });
  homePitcher = documents.publicPlayerStatsWrites.find(
    (write) => write.playerId === "home-1",
  ).data;
  assert.equal(
    projectDiamondStats(game.ledger).players["home-1"].raw.pitching.L,
    0,
  );
  assert.equal(homePitcher.statCoverage.l, "not_collected");
  assert.equal(Object.hasOwn(homePitcher.stats, "l"), false);
});

test("pitcher decision projection uses the official forfeit winner and suppresses tie, cancellation, and no-decision finals", () => {
  const prepareDecisionPlay = () => {
    const game = harness("quick", "baseball-nfhs");
    setLineupsAndStart(game);
    addHomeRun(game, { pitch: false });
    while (game.ledger.state.inning.outs < 3) recordOut(game);
    game.submit("advance_half_inning", {});
    const { batterId, pitcherId } = currentMatchup(game);
    const play = game.submit("record_plate_appearance", {
      batterId,
      pitcherId,
      result: "ground_out",
      batterAdvance: { to: "out", outKind: "batter_runner" },
      runnerAdvances: [],
      outsOnPlay: 1,
    });
    return { game, playEventId: play.eventId };
  };

  const forfeit = prepareDecisionPlay();
  forfeit.game.submit("record_scoring_judgment", {
    playEventId: forfeit.playEventId,
    pitcherOfRecord: { side: "home", playerId: "home-1", decision: "win" },
  });
  forfeit.game.submit("record_scoring_judgment", {
    playEventId: forfeit.playEventId,
    pitcherOfRecord: { side: "away", playerId: "away-1", decision: "loss" },
  });
  forfeit.game.submit("rules_decision", {
    code: "end_game_forfeit_home",
    description: "The umpire awarded home the game despite the away lead.",
  });
  forfeit.game.submit("finalize", { confirmed: true });
  const forfeitDocuments = buildDiamondStatDocuments({
    ledger: forfeit.game.ledger,
    orientationSnapshot: orientationFor("home"),
    playerDirectory: DIRECTORY,
    publicPlayerStatIds: ALL_PUBLIC_PLAYER_STAT_IDS,
    publicTeamStatIds: ALL_PUBLIC_TEAM_STAT_IDS,
  });
  const winningPitcher = forfeitDocuments.publicPlayerStatsWrites.find(
    (write) => write.playerId === "home-1",
  ).data;
  assert.deepEqual(forfeit.game.ledger.state.score, { home: 0, away: 1 });
  assert.equal(winningPitcher.statCoverage.w, "complete");
  assert.equal(winningPitcher.stats.w, 1);
  assert.equal(forfeitDocuments.opponentStats["away-1"].l, 1);

  const tied = harness("quick", "baseball-nfhs");
  setLineupsAndStart(tied);
  tied.submit("rules_decision", {
    code: "end_game_weather",
    description: "The umpire declared the tied game official.",
  });
  tied.submit("finalize", { confirmed: true });
  const tiedDocuments = buildDiamondStatDocuments({
    ledger: tied.ledger,
    orientationSnapshot: orientationFor("home"),
    playerDirectory: DIRECTORY,
    publicPlayerStatIds: ALL_PUBLIC_PLAYER_STAT_IDS,
    publicTeamStatIds: ALL_PUBLIC_TEAM_STAT_IDS,
  });
  const tiedPitcher = tiedDocuments.publicPlayerStatsWrites.find(
    (write) => write.playerId === "home-1",
  ).data;
  assert.equal(tiedPitcher.statCoverage.w, "not_collected");
  assert.equal(tiedPitcher.statCoverage.l, "not_collected");
  assert.equal(tiedPitcher.statCoverage.sv, "not_collected");
  assert.equal(Object.hasOwn(tiedPitcher.stats, "w"), false);

  const noDecision = harness("quick", "baseball-nfhs");
  setLineupsAndStart(noDecision);
  addHomeRun(noDecision, { pitch: false });
  noDecision.submit("rules_decision", {
    code: "end_game_weather",
    description: "The scored game ended without pitcher decisions.",
  });
  noDecision.submit("finalize", { confirmed: true });
  const noDecisionDocuments = buildDiamondStatDocuments({
    ledger: noDecision.ledger,
    orientationSnapshot: orientationFor("home"),
    playerDirectory: DIRECTORY,
    publicPlayerStatIds: ALL_PUBLIC_PLAYER_STAT_IDS,
    publicTeamStatIds: ALL_PUBLIC_TEAM_STAT_IDS,
  });
  const noDecisionPitcher = noDecisionDocuments.publicPlayerStatsWrites.find(
    (write) => write.playerId === "home-1",
  ).data;
  assert.equal(noDecisionPitcher.statCoverage.w, "not_collected");
  assert.equal(Object.hasOwn(noDecisionPitcher.stats, "w"), false);

  const partial = prepareDecisionPlay();
  partial.game.submit("record_scoring_judgment", {
    playEventId: partial.playEventId,
    pitcherOfRecord: { side: "away", playerId: "away-1", decision: "win" },
  });
  partial.game.submit("rules_decision", {
    code: "end_game_weather",
    description: "The scored game ended with only a winning-pitcher decision.",
  });
  partial.game.submit("finalize", { confirmed: true });
  const partialDocuments = buildDiamondStatDocuments({
    ledger: partial.game.ledger,
    orientationSnapshot: orientationFor("away"),
    playerDirectory: DIRECTORY,
    publicPlayerStatIds: ALL_PUBLIC_PLAYER_STAT_IDS,
    publicTeamStatIds: ALL_PUBLIC_TEAM_STAT_IDS,
  });
  const partialPitcher = partialDocuments.publicPlayerStatsWrites.find(
    (write) => write.playerId === "away-1",
  ).data;
  assert.equal(
    projectDiamondStats(partial.game.ledger).players["away-1"].raw.pitching.W,
    1,
  );
  assert.equal(partialPitcher.statCoverage.w, "not_collected");
  assert.equal(Object.hasOwn(partialPitcher.stats, "w"), false);

  const cancelled = prepareDecisionPlay();
  cancelled.game.submit("record_scoring_judgment", {
    playEventId: cancelled.playEventId,
    pitcherOfRecord: { side: "away", playerId: "away-1", decision: "win" },
  });
  cancelled.game.submit(
    "cancel",
    {
      confirmed: true,
      reason: "The exhibition ended without an official result.",
    },
    SCORER_UID,
    { managerAuthorized: true },
  );
  const cancelledDocuments = buildDiamondStatDocuments({
    ledger: cancelled.game.ledger,
    orientationSnapshot: orientationFor("home"),
    playerDirectory: DIRECTORY,
    publicPlayerStatIds: ALL_PUBLIC_PLAYER_STAT_IDS,
    publicTeamStatIds: ALL_PUBLIC_TEAM_STAT_IDS,
  });
  const cancelledPitcher = cancelledDocuments.opponentStats["away-1"];
  assert.equal(
    projectDiamondStats(cancelled.game.ledger).players["away-1"].raw.pitching.W,
    0,
  );
  assert.equal(Object.hasOwn(cancelledPitcher, "w"), false);
  assert.equal(Object.hasOwn(cancelledPitcher, "l"), false);
  assert.equal(Object.hasOwn(cancelledPitcher, "sv"), false);
});

test("public current state and replay never expose private notes, actors, transcripts, or private rule text", () => {
  const { game } = buildFullGameWithPrivateData();
  const bundle = bundleFor(game.ledger, { pageSize: 2 });
  const privateJson = JSON.stringify(bundle.writes.privateCurrent.data);
  const publicJson = JSON.stringify({
    current: bundle.writes.publicCurrent.data,
    pages: bundle.writes.publicReplayPages,
    plays: bundle.publicPlays,
    stats: bundle.writes.publicPlayerStats,
    effects: bundle.effects,
  });

  assert.match(privateJson, new RegExp(PRIVATE_SENTINEL));
  assert.doesNotMatch(publicJson, new RegExp(PRIVATE_SENTINEL));
  assert.doesNotMatch(
    publicJson,
    /actorUid|commandId|transcript|rawAudio|visibility/,
  );
  assert.ok(
    bundle.publicPlays.some(
      (play) =>
        play.type === "rules_decision" &&
        play.description === "Rules decision recorded",
    ),
  );
  assert.equal(
    bundle.publicPlays.some((play) => play.type === "private_note"),
    false,
  );
});

test("replay pagination is deterministic, revision-pinned, and explicitly deletes stale pages", () => {
  const { game } = buildFullGameWithPrivateData();
  const plays = buildDiamondPublicPlays({
    ledger: game.ledger,
    playerDirectory: DIRECTORY,
  });
  const options = {
    plays,
    sourceRevision: game.ledger.state.revision,
    checkpointHash: game.ledger.state.checkpointHash,
    pageSize: 2,
    existingPageIds: ["page-000001", "page-999999"],
  };
  const first = buildDiamondReplayPages(options);
  const second = buildDiamondReplayPages(options);

  assert.deepEqual(first, second);
  assert.equal(first.manifest.itemCount, plays.length);
  assert.equal(first.manifest.sourceRevision, game.ledger.state.revision);
  assert.equal(first.manifest.checkpointHash, game.ledger.state.checkpointHash);
  assert.equal(first.manifest.ordering, "effective-source-revision");
  assert.equal(first.manifest.revisionGapsAllowed, true);
  assert.equal(first.pages[0].data.pageSize, 2);
  assert.equal(first.pages[0].data.nextPageId, "page-000002");
  assert.match(first.pages[0].data.nextCursor, /^2:event-2$/);
  assert.equal(first.pages.at(-1).data.collectionComplete, true);
  assert.deepEqual(first.deletePageIds, ["page-999999"]);
});

test("live effects use revision keys and suppress rebuilds, duplicates, private notes, and rules decisions", () => {
  const { game, homeRun } = buildFullGameWithPrivateData();
  const first = bundleFor(game.ledger, {
    projectionSource: "live-command",
    previousEffectRevision: homeRun.revision - 1,
    previousNotificationRevision: homeRun.revision - 1,
    previousClipRevision: homeRun.revision - 1,
    clipTimingsByEventId: {
      [homeRun.eventId]: { startMs: 1_000, endMs: 9_000 },
    },
  });

  assert.equal(first.effects.notifications.length, 1);
  assert.equal(first.effects.notifications[0].sourceRevision, homeRun.revision);
  assert.equal(first.effects.clipLinks.length, 1);
  assert.equal(first.effects.clipLinks[0].sourceEventId, homeRun.eventId);
  assert.match(
    first.effects.notifications[0].dedupKey,
    new RegExp(`:instance:${INSTANCE_ID}:notification:r0000000008$`),
  );
  assert.match(
    first.effects.clipLinks[0].dedupKey,
    new RegExp(`:instance:${INSTANCE_ID}:clip:r0000000008$`),
  );
  assert.equal(first.effects.instanceId, INSTANCE_ID);
  assert.equal(
    first.effects.suppressed.some(
      (entry) => entry.sourceRevision > homeRun.revision,
    ),
    true,
  );

  const duplicate = bundleFor(game.ledger, {
    projectionSource: "live-command",
    previousEffectRevision: homeRun.revision - 1,
    previousNotificationRevision: homeRun.revision - 1,
    previousClipRevision: homeRun.revision - 1,
    existingEffectKeys: [
      first.effects.notifications[0].dedupKey,
      first.effects.clipLinks[0].dedupKey,
    ],
    clipTimingsByEventId: {
      [homeRun.eventId]: { startMs: 1_000, endMs: 9_000 },
    },
  });
  assert.equal(duplicate.effects.notifications.length, 0);
  assert.equal(duplicate.effects.clipLinks.length, 0);

  const rebuild = bundleFor(game.ledger, {
    projectionSource: "projection-rebuild",
    previousEffectRevision: homeRun.revision - 1,
    clipTimingsByEventId: {
      [homeRun.eventId]: { startMs: 1_000, endMs: 9_000 },
    },
  });
  assert.equal(rebuild.effects.notifications.length, 0);
  assert.equal(rebuild.effects.clipLinks.length, 0);

  const standalone = buildDiamondEffectsPlan({
    ledger: game.ledger,
    instanceId: INSTANCE_ID,
    playerDirectory: DIRECTORY,
    projectionSource: "live-command",
    previousEffectRevision: homeRun.revision - 1,
    previousNotificationRevision: homeRun.revision - 1,
    previousClipRevision: homeRun.revision - 1,
    publicPlays: [
      {
        eventId: homeRun.eventId,
        description: PRIVATE_SENTINEL,
      },
    ],
    clipTimingsByEventId: {
      [homeRun.eventId]: { startMs: 1_000, endMs: 9_000 },
    },
  });
  assert.doesNotMatch(JSON.stringify(standalone), new RegExp(PRIVATE_SENTINEL));
  assert.match(standalone.notifications[0].body, /hit a home run/i);
});

test("effect idempotency keys are immutable-scorebook-instance scoped", () => {
  const { game, homeRun } = buildFullGameWithPrivateData();
  const options = {
    ledger: game.ledger,
    playerDirectory: DIRECTORY,
    projectionSource: "live-command",
    previousEffectRevision: homeRun.revision - 1,
    previousNotificationRevision: homeRun.revision - 1,
    previousClipRevision: homeRun.revision - 1,
    clipTimingsByEventId: {
      [homeRun.eventId]: { startMs: 1_000, endMs: 9_000 },
    },
  };
  const first = buildDiamondEffectsPlan({
    ...options,
    instanceId: INSTANCE_ID,
  });
  const replacementInstanceId = uuid(901);
  const replacement = buildDiamondEffectsPlan({
    ...options,
    instanceId: replacementInstanceId,
  });

  assert.equal(first.notifications.length, 1);
  assert.equal(replacement.notifications.length, 1);
  assert.notEqual(
    first.notifications[0].dedupKey,
    replacement.notifications[0].dedupKey,
  );
  assert.notEqual(
    first.clipLinks[0].dedupKey,
    replacement.clipLinks[0].dedupKey,
  );
  assert.match(
    replacement.notifications[0].dedupKey,
    new RegExp(`:instance:${replacementInstanceId}:notification:`),
  );
  assert.throws(
    () => buildDiamondEffectsPlan(options),
    (error) => error.code === "invalid-effect-instance",
  );
});

test("void corrections rebuild score/stats/replay, stale AI, and emit only a deduped clip invalidation", () => {
  const { game, homeRun } = buildFullGameWithPrivateData();
  const correction = game.submit("void_event", {
    targetEventId: homeRun.eventId,
    reason: "Official scorer reversed the hit.",
  });
  const bundle = bundleFor(game.ledger, {
    projectionSource: "live-command",
    previousEffectRevision: correction.revision - 1,
    previousNotificationRevision: correction.revision - 1,
    previousClipRevision: correction.revision - 1,
    aiArtifacts: {
      aiRecap: { sourceRevision: homeRun.revision, text: "Old recap" },
      insights: "Old insight",
    },
  });
  const batter = playerWrite(bundle, "away-1");

  assert.equal(bundle.writes.gameUpdate.awayScore, 0);
  assert.equal(batter.stats.hr, 0);
  assert.equal(batter.stats.r, 0);
  assert.equal(
    bundle.publicPlays.some((play) => play.sourceEventId === homeRun.eventId),
    false,
  );
  assert.equal(
    bundle.publicPlays.some((play) => play.type === "void_event"),
    false,
  );
  assert.equal(bundle.writes.aiArtifactPatches.aiRecap.status, "stale");
  assert.equal(bundle.writes.aiArtifactPatches.insights.status, "stale");
  assert.deepEqual(bundle.aiStaleness.affectedSourcePlayIds, [homeRun.eventId]);
  assert.equal(bundle.effects.notifications.length, 0);
  assert.equal(bundle.effects.clipLinks.length, 0);
  assert.equal(bundle.effects.clipInvalidations.length, 1);
  assert.equal(
    bundle.effects.clipInvalidations[0].targetEventId,
    homeRun.eventId,
  );

  const duplicate = bundleFor(game.ledger, {
    projectionSource: "live-command",
    previousEffectRevision: correction.revision - 1,
    existingEffectKeys: [bundle.effects.clipInvalidations[0].dedupKey],
  });
  assert.equal(duplicate.effects.clipInvalidations.length, 0);

  const coldRecovery = bundleFor(game.ledger, {
    projectionSource: "live-command",
    previousEffectRevision: 0,
    previousNotificationRevision: 0,
    previousClipRevision: 0,
    clipTimingsByEventId: {
      [homeRun.eventId]: { startMs: 1_000, endMs: 9_000 },
    },
  });
  assert.equal(
    coldRecovery.effects.notifications.some(
      (effect) => effect.sourceEventId === homeRun.eventId,
    ),
    false,
  );
  assert.equal(
    coldRecovery.effects.clipLinks.some(
      (effect) => effect.sourceEventId === homeRun.eventId,
    ),
    false,
  );

  const regenerated = bundleFor(game.ledger, {
    aiArtifacts: {
      aiRecap: { sourceRevision: correction.revision, text: "Current recap" },
    },
  });
  assert.equal(regenerated.aiStaleness.required, false);
  assert.deepEqual(regenerated.writes.aiArtifactPatches, {});
  assert.equal(regenerated.writes.diamondAiState, null);
});

test("voided private notes leave current private projection while immutable history remains authoritative", () => {
  const { game } = buildFullGameWithPrivateData();
  const note = game.ledger.events.find(
    (event) => event.type === "private_note",
  );
  const correction = game.submit("void_event", {
    targetEventId: note.eventId,
    reason: "Remove note from the current scorer view.",
  });
  const bundle = bundleFor(game.ledger, {
    projectionSource: "live-command",
    previousEffectRevision: correction.revision - 1,
  });

  assert.equal(
    bundle.writes.privateCurrent.data.privateNotes.some(
      (entry) => entry.sourceEventId === note.eventId,
    ),
    false,
  );
  assert.equal(
    game.ledger.events.some((event) => event.eventId === note.eventId),
    true,
  );
  assert.equal(bundle.effects.clipInvalidations.length, 0);
  assert.equal(
    bundle.effects.suppressed.some(
      (entry) => entry.reason === "corrected-event-not-clip-eligible",
    ),
    true,
  );
});

test("private current notes are bounded with explicit truncation evidence", () => {
  const game = harness("quick");
  game.submit("activate", {
    initialScorerUid: SCORER_UID,
    captureMode: "quick",
  });
  for (let index = 1; index <= 102; index += 1) {
    game.submit("private_note", {
      text: `Bounded private note ${String(index)}`,
    });
  }
  const bundle = bundleFor(game.ledger);
  const current = bundle.writes.privateCurrent.data;

  assert.equal(current.privateNoteCount, 102);
  assert.equal(current.privateNotes.length, 100);
  assert.equal(current.privateNotesComplete, false);
  assert.equal(current.privateNotesTruncated, true);
  assert.equal(current.privateNotesWindowStartRevision, 4);
  assert.equal(current.privateNotes[0].text, "Bounded private note 3");
  assert.equal(current.privateNotes.at(-1).text, "Bounded private note 102");
});

test("superseded plays retain chronological source revision while identifying the correction event", () => {
  const game = harness("full");
  setLineupsAndStart(game);
  const original = addHomeRun(game);
  const correction = game.submit("supersede_event", {
    targetEventId: original.eventId,
    reason: "Changed to a triple after review.",
    replacement: {
      type: "record_plate_appearance",
      payload: {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "triple",
        batterAdvance: { to: "third", cause: "batted_ball" },
        runnerAdvances: [],
        outsOnPlay: 0,
        runsBattedIn: 0,
      },
    },
  });
  const bundle = bundleFor(game.ledger, { pageSize: 2 });
  const corrected = bundle.publicPlays.find(
    (play) => play.sourceEventId === original.eventId,
  );

  assert.ok(corrected);
  assert.equal(corrected.eventId, correction.eventId);
  assert.equal(corrected.revision, original.revision);
  assert.equal(corrected.sequence, original.revision);
  assert.equal(corrected.corrected, true);
  assert.match(corrected.description, /tripled/);
  assert.equal(
    bundle.writes.publicReplayManifest.data.sourceRevision,
    correction.revision,
  );
  assert.equal(
    bundle.writes.publicReplayManifest.data.revisionGapsAllowed,
    true,
  );
  assert.equal(
    bundle.writes.publicReplayManifest.data.itemCount,
    bundle.publicPlays.length,
  );
  assert.equal(bundle.writes.gameUpdate.awayScore, 0);
});

test("public plays use correction-aware replay across suspended and ready obsolete finalization pairs", () => {
  const suspended = harness("quick", "baseball-youth");
  setLineupsAndStart(suspended);
  const { batterId, pitcherId } = currentMatchup(suspended);
  const play = suspended.submit("record_plate_appearance", {
    batterId,
    pitcherId,
    result: "ground_out",
    batterAdvance: { to: "out", outKind: "batter_runner" },
    runnerAdvances: [],
    outsOnPlay: 1,
  });
  suspended.submit("suspend", { reason: "Weather delay." });
  const obsoleteEnding = suspended.submit("rules_decision", {
    code: "end_game_weather",
    description: "The initial ruling ended the game.",
  });
  suspended.submit("finalize", { confirmed: true });
  suspended.submit("private_note", {
    text: "Audit note between the obsolete finalization and reopen.",
  });
  suspended.submit("reopen_for_correction", {
    reason: "Review whether weather ended the game.",
  });
  const correctedEnding = suspended.submit("supersede_event", {
    targetEventId: obsoleteEnding.eventId,
    reason: "The interruption did not end the game.",
    replacement: {
      type: "rules_decision",
      payload: {
        code: "coverage_adjustment",
        description: "The interruption left fielding coverage incomplete.",
        affectedFamilies: ["fielding"],
      },
    },
  });
  suspended.submit("record_fielding", {
    playEventId: play.eventId,
    fielding: { putoutBy: "home-2" },
  });
  suspended.submit("rules_decision", {
    code: "end_game_weather",
    description: "A later ruling made the corrected game official.",
  });
  suspended.submit("finalize", { confirmed: true });

  const suspendedPlays = buildDiamondPublicPlays({
    ledger: suspended.ledger,
    playerDirectory: DIRECTORY,
  });
  assert.equal(
    suspendedPlays.filter((candidate) => candidate.type === "finalize").length,
    1,
  );
  assert.equal(
    suspendedPlays.some(
      (candidate) => candidate.type === "reopen_for_correction",
    ),
    false,
  );
  assert.ok(
    suspendedPlays.some(
      (candidate) =>
        candidate.eventId === correctedEnding.eventId &&
        candidate.sourceEventId === obsoleteEnding.eventId &&
        candidate.corrected === true,
    ),
  );
  assert.equal(suspendedPlays.at(-1).type, "finalize");
  const suspendedBundle = bundleFor(suspended.ledger);
  assert.equal(suspendedBundle.publicPlays.at(-1).type, "finalize");
  assert.equal(suspendedBundle.writes.publicCurrent.data.lifecycle, "final");

  const ready = harness("quick", "baseball-obr");
  ready.submit("activate", {
    initialScorerUid: SCORER_UID,
    captureMode: "quick",
  });
  const obsoleteForfeit = ready.submit("rules_decision", {
    code: "end_game_forfeit_away",
    description: "The initial pregame forfeit ended the game.",
  });
  ready.submit("finalize", { confirmed: true });
  ready.submit("reopen_for_correction", {
    reason: "The pregame ruling must be corrected.",
  });
  ready.submit("void_event", {
    targetEventId: obsoleteForfeit.eventId,
    reason: "The initial forfeit ruling was rescinded.",
  });
  ready.submit("rules_decision", {
    code: "end_game_forfeit_home",
    description: "The corrected pregame ruling awards home the game.",
  });
  ready.submit("finalize", { confirmed: true });
  const readyPlays = buildDiamondPublicPlays({
    ledger: ready.ledger,
    playerDirectory: DIRECTORY,
  });
  assert.equal(
    readyPlays.filter((candidate) => candidate.type === "finalize").length,
    1,
  );
  assert.equal(
    readyPlays.some((candidate) => candidate.type === "reopen_for_correction"),
    false,
  );
  assert.equal(readyPlays.at(-1).type, "finalize");
});

test("shared-game reconciliation uses only established score/status fields and returns explicit outcome evidence", () => {
  const game = harness("full");
  setLineupsAndStart(game);
  addHomeRun(game);
  game.submit("rules_decision", {
    code: "end_game_weather",
    description: "The umpire declared the game official.",
  });
  game.submit("finalize", { confirmed: true });
  const shared = buildDiamondSharedGameOutcome({
    ledger: game.ledger,
    sharedGame: { homeTeamId: "team-home", awayTeamId: "team-away" },
  });

  assert.deepEqual(
    {
      homeScore: shared.update.homeScore,
      awayScore: shared.update.awayScore,
      status: shared.update.status,
      liveStatus: shared.update.liveStatus,
    },
    {
      homeScore: 0,
      awayScore: 1,
      status: "completed",
      liveStatus: "completed",
    },
  );
  assert.equal(shared.outcome.final, true);
  assert.equal(shared.outcome.winnerSide, "away");
  assert.equal(shared.outcome.winnerTeamId, "team-away");
  assert.deepEqual(shared.outcome.teamOutcomes, {
    "team-home": "loss",
    "team-away": "win",
  });
});

test("forfeit outcome follows the audited awarded side even when the score is tied", () => {
  const game = harness("quick");
  game.submit("activate", {
    initialScorerUid: SCORER_UID,
    captureMode: "quick",
  });
  game.submit("rules_decision", {
    code: "end_game_forfeit_away",
    description: "The umpire awarded the game to the away team.",
  });
  game.submit("finalize", { confirmed: true });

  const shared = buildDiamondSharedGameOutcome({
    ledger: game.ledger,
    sharedGame: { homeTeamId: "team-home", awayTeamId: "team-away" },
  });

  assert.deepEqual(game.ledger.state.score, { home: 0, away: 0 });
  assert.equal(shared.outcome.final, true);
  assert.equal(shared.outcome.tie, false);
  assert.equal(shared.outcome.winnerSide, "away");
  assert.equal(shared.outcome.winnerTeamId, "team-away");
  assert.deepEqual(shared.outcome.teamOutcomes, {
    "team-home": "loss",
    "team-away": "win",
  });
});

test("cancelled projections are terminal and never expose the private cancellation reason", () => {
  const privateReason = "Parent medical detail must remain private";
  const game = harness("quick");
  game.submit("activate", {
    initialScorerUid: SCORER_UID,
    captureMode: "quick",
  });
  game.submit(
    "cancel",
    { confirmed: true, reason: privateReason },
    SCORER_UID,
    { managerAuthorized: true },
  );

  const bundle = bundleFor(game.ledger);
  const current = bundle.writes.publicCurrent.data;
  const publicJson = JSON.stringify({
    current,
    pages: bundle.writes.publicReplayPages,
  });

  assert.equal(current.status, "cancelled");
  assert.equal(current.lifecycle, "cancelled");
  assert.equal(current.readOnlyReason, "game-cancelled");
  assert.equal(current.lastPlay.description, "Game cancelled");
  assert.equal(publicJson.includes(privateReason), false);
});

test("projection uses the immutable orientation snapshot and ignores mutable game orientation", () => {
  const { game } = buildFullGameWithPrivateData();
  const bundle = buildDiamondProjectionBundle({
    ledger: game.ledger,
    instanceId: INSTANCE_ID,
    orientationSnapshot: orientationFor("away"),
    // These legacy schedule fields are mutable and intentionally conflict with
    // the activation-pinned orientation.
    teamSide: "home",
    game: {
      isHome: true,
      homeTeamId: "team-away",
      awayTeamId: "mutated-opponent",
      teamName: "Mutated Team",
      opponent: "Mutated Opponent",
    },
    playerDirectory: DIRECTORY,
    publicPlayerStatIds: ALL_PUBLIC_PLAYER_STAT_IDS,
    publicTeamStatIds: ALL_PUBLIC_TEAM_STAT_IDS,
  });

  assert.equal(bundle.writes.teamStats.data.side, "away");
  assert.equal(bundle.writes.gameUpdate.diamondPublicTeamStats.side, "away");
  assert.equal(bundle.writes.publicCurrent.data.teamName, "Away Team");
  assert.equal(bundle.writes.publicCurrent.data.opponentName, "Home Team");
  assert.equal(bundle.writes.publicCurrent.data.home.name, "Home Team");
  assert.equal(bundle.writes.publicCurrent.data.away.name, "Away Team");
  assert.equal(bundle.writes.gameUpdate.opponentStats["home-1"].p_h, 1);
});

test("projection fails closed for missing or malformed orientation and tampered inputs", () => {
  const game = harness("full");
  setLineupsAndStart(game);
  assert.throws(
    () => buildDiamondStatDocuments({ ledger: game.ledger }),
    (error) =>
      error instanceof DiamondProjectionError &&
      error.code === "orientation-snapshot-required",
  );
  assert.throws(
    () =>
      buildDiamondStatDocuments({
        ledger: game.ledger,
        orientationSnapshot: orientationFor("away", {
          homeTeamId: "team-away",
        }),
      }),
    (error) =>
      error instanceof DiamondProjectionError &&
      error.code === "orientation-snapshot-mismatch",
  );
  assert.throws(
    () =>
      buildDiamondReplayPages({
        plays: [],
        sourceRevision: game.ledger.state.revision,
        checkpointHash: "not-a-hash",
      }),
    (error) =>
      error instanceof DiamondProjectionError &&
      error.code === "invalid-argument",
  );
  const tampered = {
    ...game.ledger,
    state: { ...game.ledger.state, score: { home: 99, away: 99 } },
  };
  assert.throws(() => bundleFor(tampered), /checkpoint|replay|state/i);
  assert.throws(
    () =>
      buildDiamondSharedGameOutcome({
        ledger: game.ledger,
        sharedGame: {
          homeTeamId: "different-home",
          awayTeamId: "different-away",
        },
      }),
    (error) =>
      error instanceof DiamondProjectionError &&
      error.code === "invalid-shared-game",
  );
  assert.throws(
    () =>
      bundleFor(game.ledger, {
        projectionSource: "live-command",
        previousEffectRevision: game.ledger.state.revision + 1,
      }),
    (error) =>
      error instanceof DiamondProjectionError &&
      error.code === "effect-checkpoint-ahead",
  );
});
