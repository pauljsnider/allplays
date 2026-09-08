"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DIAMOND_SCHEMA_VERSION,
  createDiamondLedger,
  executeDiamondCommand,
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

function harness(captureMode = "full") {
  let ledger = createDiamondLedger({
    teamId: "team-away",
    gameId: "game-1",
    rulesProfileId: "baseball-youth",
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

  return {
    get ledger() {
      return ledger;
    },
    submit,
  };
}

function setLineupsAndStart(game) {
  game.submit("activate", {
    initialScorerUid: SCORER_UID,
    captureMode: game.ledger.captureMode,
  });
  game.submit("set_lineup", {
    side: "home",
    entries: [
      {
        slot: 1,
        playerId: "home-1",
        displayName: "Casey Home",
        jerseyNumber: "21",
      },
      {
        slot: 2,
        playerId: "home-2",
        displayName: "Devon Home",
        jerseyNumber: "22",
      },
    ],
  });
  game.submit("set_lineup", {
    side: "away",
    entries: [
      {
        slot: 1,
        playerId: "away-1",
        displayName: "Alex Away",
        jerseyNumber: "11",
      },
      {
        slot: 2,
        playerId: "away-2",
        displayName: "Bailey Away",
        jerseyNumber: "12",
      },
    ],
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

test("completed public projection preserves the current matchup without exposing roster details", () => {
  const configuredProjection = bundleFor(
    harness("full").ledger,
  ).writes.publicCurrent.data;
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
  game.submit("rules_decision", {
    code: "end_game_weather",
    description: "The umpire declared the game official.",
  });
  game.submit("finalize", { confirmed: true });

  const documents = buildDiamondStatDocuments({
    ledger: game.ledger,
    orientationSnapshot: orientationFor("home"),
    playerDirectory: DIRECTORY,
    publicPlayerStatIds: ALL_PUBLIC_PLAYER_STAT_IDS,
    publicTeamStatIds: ALL_PUBLIC_TEAM_STAT_IDS,
  });
  const homePitcher = documents.publicPlayerStatsWrites.find(
    (write) => write.playerId === "home-1",
  ).data;

  assert.equal(homePitcher.statCoverage.w, "complete");
  assert.equal(homePitcher.stats.w, 0);
  assert.equal(homePitcher.stats.l, 1);
  assert.equal(homePitcher.stats.sv, 0);
  assert.equal(documents.opponentStats["away-1"].w, 1);
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
