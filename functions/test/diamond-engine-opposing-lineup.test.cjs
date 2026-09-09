"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DIAMOND_SCHEMA_VERSION,
  createDiamondCheckpoint,
  createDiamondLedger,
  executeDiamondCommand,
  executeDiamondCommandFromCheckpoint,
  replayDiamondLedger,
  verifyDiamondLedger,
} = require("../diamond-engine");

const SCORER_UID = "compiled-opposing-lineup-scorer";

function createCourtesyGame(label) {
  let ledger = createDiamondLedger({
    teamId: `compiled-${label}-team`,
    gameId: `compiled-${label}-game`,
    rulesProfileId: "fastpitch-nfhs",
    rulesProfileVersion: 1,
    captureMode: "full",
  });
  let commandIndex = 1;
  const submit = (type, payload) => {
    const index = commandIndex;
    const execution = executeDiamondCommand(
      ledger,
      {
        schemaVersion: DIAMOND_SCHEMA_VERSION,
        commandId: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        teamId: ledger.teamId,
        gameId: ledger.gameId,
        expectedRevision: ledger.state.revision,
        rulesProfileId: ledger.rulesProfileId,
        rulesProfileVersion: ledger.rulesProfileVersion,
        type,
        payload,
      },
      {
        actorUid: SCORER_UID,
        eventId: `compiled-${label}-event-${String(index)}`,
        serverTimestampMs: 1_800_000_300_000 + index,
      },
    );
    commandIndex += 1;
    if (execution.result.outcome === "accepted") ledger = execution.ledger;
    return execution;
  };
  for (const [type, payload] of [
    ["activate", { initialScorerUid: SCORER_UID, captureMode: "full" }],
    [
      "set_lineup",
      {
        side: "home",
        entries: [
          { slot: 1, playerId: "home-1" },
          { slot: 2, playerId: "home-2" },
        ],
      },
    ],
    [
      "set_lineup",
      {
        side: "away",
        entries: [
          { slot: 1, playerId: "away-1" },
          { slot: 2, playerId: "away-2" },
        ],
      },
    ],
    [
      "set_defensive_alignment",
      { side: "home", assignments: [{ position: "P", playerId: "home-1" }] },
    ],
    [
      "set_defensive_alignment",
      { side: "away", assignments: [{ position: "P", playerId: "away-1" }] },
    ],
    ["start", {}],
    [
      "record_plate_appearance",
      {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "single",
        batterAdvance: { to: "first" },
        runnerAdvances: [],
        outsOnPlay: 0,
      },
    ],
  ]) {
    assert.equal(submit(type, payload).result.outcome, "accepted");
  }
  return {
    get ledger() {
      return ledger;
    },
    submit,
  };
}

test("compiled engine rejects one player identity across opposing batting lineups without advancing state", () => {
  let ledger = createDiamondLedger({
    teamId: "compiled-opposing-team",
    gameId: "compiled-opposing-game",
    rulesProfileId: "baseball-nfhs",
    rulesProfileVersion: 1,
    captureMode: "full",
  });
  let commandIndex = 1;

  const submit = (type, payload) => {
    const index = commandIndex;
    const execution = executeDiamondCommand(
      ledger,
      {
        schemaVersion: DIAMOND_SCHEMA_VERSION,
        commandId: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        teamId: ledger.teamId,
        gameId: ledger.gameId,
        expectedRevision: ledger.state.revision,
        rulesProfileId: ledger.rulesProfileId,
        rulesProfileVersion: ledger.rulesProfileVersion,
        type,
        payload,
      },
      {
        actorUid: SCORER_UID,
        eventId: `compiled-opposing-event-${String(index)}`,
        serverTimestampMs: 1_800_000_100_000 + index,
      },
    );
    commandIndex += 1;
    if (execution.result.outcome === "accepted") ledger = execution.ledger;
    return execution;
  };

  assert.equal(
    submit("activate", { initialScorerUid: SCORER_UID, captureMode: "full" })
      .result.outcome,
    "accepted",
  );
  assert.equal(
    submit("set_lineup", {
      side: "home",
      entries: [{ slot: 1, playerId: "compiled-shared-player" }],
    }).result.outcome,
    "accepted",
  );
  const beforeCollision = ledger;

  const collision = submit("set_lineup", {
    side: "away",
    entries: [{ slot: 1, playerId: "compiled-shared-player" }],
  });

  assert.equal(collision.result.outcome, "rejected");
  assert.equal(collision.result.rejection?.code, "opposing-lineup-player");
  assert.strictEqual(collision.ledger, beforeCollision);
  assert.equal(collision.ledger.state.revision, beforeCollision.state.revision);
  assert.equal(collision.ledger.events.length, beforeCollision.events.length);
  assert.deepEqual(collision.ledger.state.lineups.away.battingOrder, []);

  const whitespacePayload = {
    side: "away",
    entries: [{ slot: 1, playerId: " compiled-shared-player " }],
  };
  const whitespace = submit("set_lineup", whitespacePayload);
  assert.equal(whitespace.result.rejection?.code, "invalid-id");
  const checkpoint = createDiamondCheckpoint(ledger);
  const boundedWhitespace = executeDiamondCommandFromCheckpoint(
    checkpoint,
    {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      commandId: "20000000-0000-4000-8000-000000000099",
      teamId: checkpoint.teamId,
      gameId: checkpoint.gameId,
      expectedRevision: checkpoint.sequence,
      rulesProfileId: checkpoint.rulesProfileId,
      rulesProfileVersion: checkpoint.rulesProfileVersion,
      type: "set_lineup",
      payload: whitespacePayload,
    },
    {
      actorUid: SCORER_UID,
      eventId: "compiled-noncanonical-lineup",
      serverTimestampMs: 1_800_000_100_099,
    },
  );
  assert.equal(boundedWhitespace.result.rejection?.code, "invalid-id");
  assert.strictEqual(boundedWhitespace.checkpoint, checkpoint);
});

test("compiled engine rejects an eleventh defender atomically from a checkpoint", () => {
  let ledger = createDiamondLedger({
    teamId: "compiled-defense-cap-team",
    gameId: "compiled-defense-cap-game",
    rulesProfileId: "baseball-nfhs",
    rulesProfileVersion: 1,
    captureMode: "quick",
  });
  let commandIndex = 1;
  const command = (
    type,
    payload,
    expectedRevision = ledger.state.revision,
  ) => ({
    schemaVersion: DIAMOND_SCHEMA_VERSION,
    commandId: `50000000-0000-4000-8000-${String(commandIndex).padStart(12, "0")}`,
    teamId: ledger.teamId,
    gameId: ledger.gameId,
    expectedRevision,
    rulesProfileId: ledger.rulesProfileId,
    rulesProfileVersion: ledger.rulesProfileVersion,
    type,
    payload,
  });
  const submit = (type, payload) => {
    const input = command(type, payload);
    const execution = executeDiamondCommand(ledger, input, {
      actorUid: SCORER_UID,
      eventId: `compiled-defense-cap-event-${String(commandIndex)}`,
      serverTimestampMs: 1_800_000_400_000 + commandIndex,
    });
    commandIndex += 1;
    if (execution.result.outcome === "accepted") ledger = execution.ledger;
    return execution;
  };

  assert.equal(
    submit("activate", { initialScorerUid: SCORER_UID, captureMode: "quick" })
      .result.outcome,
    "accepted",
  );
  assert.equal(
    submit("set_lineup", {
      side: "home",
      entries: [{ slot: 1, playerId: "home-batting-only" }],
    }).result.outcome,
    "accepted",
  );
  assert.equal(
    submit("set_lineup", {
      side: "away",
      entries: [{ slot: 1, playerId: "away-batter" }],
    }).result.outcome,
    "accepted",
  );
  assert.equal(
    submit("set_defensive_alignment", {
      side: "home",
      assignments: [
        "P",
        "C",
        "1B",
        "2B",
        "3B",
        "SS",
        "LF",
        "CF",
        "RCF",
        "RF",
      ].map((position, index) => ({
        position,
        playerId: `home-defense-${String(index + 1)}`,
      })),
    }).result.outcome,
    "accepted",
  );
  assert.equal(
    submit("set_defensive_alignment", {
      side: "away",
      assignments: [{ position: "P", playerId: "away-pitcher" }],
    }).result.outcome,
    "accepted",
  );
  assert.equal(submit("start", {}).result.outcome, "accepted");

  const checkpoint = createDiamondCheckpoint(ledger);
  const overflowCommand = command(
    "substitute",
    {
      side: "home",
      battingSlot: 1,
      outgoingPlayerId: "home-batting-only",
      incomingPlayerId: "home-overflow-sub",
      defensivePosition: "LCF",
    },
    checkpoint.sequence,
  );
  const execution = executeDiamondCommandFromCheckpoint(
    checkpoint,
    overflowCommand,
    {
      actorUid: SCORER_UID,
      eventId: "compiled-defense-cap-overflow",
      serverTimestampMs: 1_800_000_400_099,
    },
  );

  assert.equal(execution.result.outcome, "rejected");
  assert.equal(execution.result.rejection?.code, "invalid-defense");
  assert.strictEqual(execution.checkpoint, checkpoint);
  assert.equal(execution.checkpoint.sequence, checkpoint.sequence);
  assert.equal(
    Object.keys(execution.checkpoint.state.lineups.home.defense).length,
    10,
  );
  assert.equal(execution.checkpoint.state.lineups.home.defense.LCF, undefined);
  assert.equal(verifyDiamondLedger(ledger), true);
  assert.deepEqual(replayDiamondLedger(ledger).state, ledger.state);
});

test("compiled engine rejects an opposing courtesy runner across direct, checkpoint, and correction paths", () => {
  let ledger = createDiamondLedger({
    teamId: "compiled-courtesy-team",
    gameId: "compiled-courtesy-game",
    rulesProfileId: "fastpitch-nfhs",
    rulesProfileVersion: 1,
    captureMode: "full",
  });
  let commandIndex = 1;

  const submit = (type, payload, { update = true } = {}) => {
    const index = commandIndex;
    const execution = executeDiamondCommand(
      ledger,
      {
        schemaVersion: DIAMOND_SCHEMA_VERSION,
        commandId: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        teamId: ledger.teamId,
        gameId: ledger.gameId,
        expectedRevision: ledger.state.revision,
        rulesProfileId: ledger.rulesProfileId,
        rulesProfileVersion: ledger.rulesProfileVersion,
        type,
        payload,
      },
      {
        actorUid: SCORER_UID,
        eventId: `compiled-courtesy-event-${String(index)}`,
        serverTimestampMs: 1_800_000_200_000 + index,
      },
    );
    commandIndex += 1;
    if (update && execution.result.outcome === "accepted")
      ledger = execution.ledger;
    return execution;
  };

  for (const [type, payload] of [
    ["activate", { initialScorerUid: SCORER_UID, captureMode: "full" }],
    [
      "set_lineup",
      {
        side: "home",
        entries: [
          { slot: 1, playerId: "home-1" },
          { slot: 2, playerId: "home-2" },
        ],
      },
    ],
    [
      "set_lineup",
      {
        side: "away",
        entries: [
          { slot: 1, playerId: "away-1" },
          { slot: 2, playerId: "away-2" },
        ],
      },
    ],
    [
      "set_defensive_alignment",
      {
        side: "home",
        assignments: [
          { position: "P", playerId: "home-1" },
          { position: "C", playerId: "home-2" },
        ],
      },
    ],
    [
      "set_defensive_alignment",
      {
        side: "away",
        assignments: [
          { position: "P", playerId: "away-1" },
          { position: "C", playerId: "away-2" },
        ],
      },
    ],
    ["start", {}],
    [
      "record_plate_appearance",
      {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "single",
        batterAdvance: { to: "first" },
        runnerAdvances: [],
        outsOnPlay: 0,
      },
    ],
  ]) {
    assert.equal(submit(type, payload).result.outcome, "accepted");
  }

  const beforeCollision = ledger;
  const collisionPayload = {
    side: "away",
    forPlayerId: "away-1",
    runnerId: "home-1",
    base: "first",
    forRole: "pitcher",
  };
  const collision = submit("add_courtesy_runner", collisionPayload, {
    update: false,
  });
  assert.equal(collision.result.outcome, "rejected");
  assert.equal(collision.result.rejection?.code, "opposing-lineup-player");
  assert.strictEqual(collision.ledger, beforeCollision);
  assert.equal(collision.ledger.state.revision, beforeCollision.state.revision);
  assert.equal(collision.ledger.events.length, beforeCollision.events.length);

  const checkpoint = createDiamondCheckpoint(beforeCollision);
  const boundedCollision = executeDiamondCommandFromCheckpoint(
    checkpoint,
    {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      commandId: "30000000-0000-4000-8000-000000000099",
      teamId: checkpoint.teamId,
      gameId: checkpoint.gameId,
      expectedRevision: checkpoint.sequence,
      rulesProfileId: checkpoint.rulesProfileId,
      rulesProfileVersion: checkpoint.rulesProfileVersion,
      type: "add_courtesy_runner",
      payload: collisionPayload,
    },
    {
      actorUid: SCORER_UID,
      eventId: "compiled-checkpoint-courtesy-collision",
      serverTimestampMs: 1_800_000_201_000,
    },
  );
  assert.equal(boundedCollision.result.outcome, "rejected");
  assert.equal(
    boundedCollision.result.rejection?.code,
    "opposing-lineup-player",
  );
  assert.strictEqual(boundedCollision.checkpoint, checkpoint);
  assert.strictEqual(boundedCollision.result.state, checkpoint.state);
  assert.equal(
    boundedCollision.checkpoint.sequence,
    beforeCollision.state.revision,
  );

  const validCourtesy = submit("add_courtesy_runner", {
    ...collisionPayload,
    runnerId: "away-courtesy",
  });
  assert.equal(validCourtesy.result.outcome, "accepted");
  assert.deepEqual(ledger.state.bases.first, {
    runnerId: "away-courtesy",
    chargedToPitcherId: "home-1",
    courtesyForPlayerId: "away-1",
    reachedOnEventId: validCourtesy.ledger.events.at(-2).eventId,
  });
  const beforeCorrection = ledger;
  const correction = submit(
    "supersede_event",
    {
      targetEventId: validCourtesy.event.eventId,
      reason: "Correct the courtesy runner without crossing team identities.",
      replacement: { type: "add_courtesy_runner", payload: collisionPayload },
    },
    { update: false },
  );
  assert.equal(correction.result.outcome, "rejected");
  assert.equal(correction.result.rejection?.code, "opposing-lineup-player");
  assert.strictEqual(correction.ledger, beforeCorrection);
  assert.equal(
    correction.ledger.state.revision,
    beforeCorrection.state.revision,
  );
  assert.equal(correction.ledger.events.length, beforeCorrection.events.length);
  assert.deepEqual(replayDiamondLedger(ledger).state, beforeCorrection.state);

  assert.equal(
    submit("advance_runner", {
      runnerId: "away-courtesy",
      from: "first",
      to: "home",
      cause: "other",
      countsRun: true,
      earned: true,
    }).result.outcome,
    "accepted",
  );
  assert.equal(ledger.state.score.away, 1);
  assert.equal(ledger.state.bases.first, null);
  assert.deepEqual(ledger.state.lineups.away.courtesyRunnerIds, [
    "away-courtesy",
  ]);
  assert.deepEqual(replayDiamondLedger(ledger).state, ledger.state);

  const departedCheckpoint = createDiamondCheckpoint(ledger);
  const departedCollision = executeDiamondCommandFromCheckpoint(
    departedCheckpoint,
    {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      commandId: "30000000-0000-4000-8000-000000000098",
      teamId: departedCheckpoint.teamId,
      gameId: departedCheckpoint.gameId,
      expectedRevision: departedCheckpoint.sequence,
      rulesProfileId: departedCheckpoint.rulesProfileId,
      rulesProfileVersion: departedCheckpoint.rulesProfileVersion,
      type: "substitute",
      payload: {
        side: "home",
        battingSlot: 2,
        outgoingPlayerId: "home-2",
        incomingPlayerId: "away-courtesy",
      },
    },
    {
      actorUid: SCORER_UID,
      eventId: "compiled-departed-courtesy-collision",
      serverTimestampMs: 1_800_000_202_000,
    },
  );
  assert.equal(departedCollision.result.outcome, "rejected");
  assert.equal(
    departedCollision.result.rejection?.code,
    "opposing-lineup-player",
  );
  assert.strictEqual(departedCollision.checkpoint, departedCheckpoint);
});

test("compiled correction replay releases voided courtesy IDs and replaces superseded IDs", () => {
  const voided = createCourtesyGame("voided-courtesy");
  const voidedCourtesy = voided.submit("add_courtesy_runner", {
    side: "away",
    forPlayerId: "away-1",
    runnerId: "released-courtesy",
    base: "first",
    forRole: "pitcher",
  });
  assert.equal(voidedCourtesy.result.outcome, "accepted");
  assert.equal(
    voided.submit("void_event", {
      targetEventId: voidedCourtesy.event.eventId,
      reason: "Remove the incorrect courtesy-runner event.",
    }).result.outcome,
    "accepted",
  );
  assert.deepEqual(voided.ledger.state.lineups.away.courtesyRunnerIds, []);
  assert.equal(
    voided.submit("substitute", {
      side: "home",
      battingSlot: 2,
      outgoingPlayerId: "home-2",
      incomingPlayerId: "released-courtesy",
    }).result.outcome,
    "accepted",
  );
  assert.equal(verifyDiamondLedger(voided.ledger), true);
  assert.deepEqual(replayDiamondLedger(voided.ledger).state, voided.ledger.state);

  const superseded = createCourtesyGame("superseded-courtesy");
  const original = superseded.submit("add_courtesy_runner", {
    side: "away",
    forPlayerId: "away-1",
    runnerId: "replaced-courtesy-a",
    base: "first",
    forRole: "pitcher",
  });
  assert.equal(original.result.outcome, "accepted");
  assert.equal(
    superseded.submit("supersede_event", {
      targetEventId: original.event.eventId,
      reason: "Correct the courtesy-runner identity.",
      replacement: {
        type: "add_courtesy_runner",
        payload: {
          side: "away",
          forPlayerId: "away-1",
          runnerId: "replacement-courtesy-b",
          base: "first",
          forRole: "pitcher",
        },
      },
    }).result.outcome,
    "accepted",
  );
  assert.deepEqual(superseded.ledger.state.lineups.away.courtesyRunnerIds, [
    "replacement-courtesy-b",
  ]);

  const checkpoint = createDiamondCheckpoint(superseded.ledger);
  const retainedCollision = executeDiamondCommandFromCheckpoint(
    checkpoint,
    {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      commandId: "40000000-0000-4000-8000-000000000099",
      teamId: checkpoint.teamId,
      gameId: checkpoint.gameId,
      expectedRevision: checkpoint.sequence,
      rulesProfileId: checkpoint.rulesProfileId,
      rulesProfileVersion: checkpoint.rulesProfileVersion,
      type: "substitute",
      payload: {
        side: "home",
        battingSlot: 2,
        outgoingPlayerId: "home-2",
        incomingPlayerId: "replacement-courtesy-b",
      },
    },
    {
      actorUid: SCORER_UID,
      eventId: "compiled-retained-replacement-collision",
      serverTimestampMs: 1_800_000_301_000,
    },
  );
  assert.equal(retainedCollision.result.rejection?.code, "opposing-lineup-player");
  assert.strictEqual(retainedCollision.checkpoint, checkpoint);
  assert.equal(
    superseded.submit("substitute", {
      side: "home",
      battingSlot: 2,
      outgoingPlayerId: "home-2",
      incomingPlayerId: "replaced-courtesy-a",
    }).result.outcome,
    "accepted",
  );
  assert.equal(verifyDiamondLedger(superseded.ledger), true);
  assert.deepEqual(replayDiamondLedger(superseded.ledger).state, superseded.ledger.state);

  const canonicalIds = createCourtesyGame("canonical-ids");
  const boundedCases = [
    [
      "set_defensive_alignment",
      {
        side: "away",
        assignments: [{ position: "P", playerId: " home-1 " }],
      },
    ],
    [
      "substitute",
      {
        side: "away",
        battingSlot: 2,
        outgoingPlayerId: "away-2",
        incomingPlayerId: " home-2 ",
      },
    ],
  ];
  boundedCases.forEach(([type, payload], index) => {
    assert.equal(canonicalIds.submit(type, payload).result.rejection?.code, "invalid-id");
    const canonicalCheckpoint = createDiamondCheckpoint(canonicalIds.ledger);
    const bounded = executeDiamondCommandFromCheckpoint(
      canonicalCheckpoint,
      {
        schemaVersion: DIAMOND_SCHEMA_VERSION,
        commandId: `40000000-0000-4000-8000-${String(200 + index).padStart(12, "0")}`,
        teamId: canonicalCheckpoint.teamId,
        gameId: canonicalCheckpoint.gameId,
        expectedRevision: canonicalCheckpoint.sequence,
        rulesProfileId: canonicalCheckpoint.rulesProfileId,
        rulesProfileVersion: canonicalCheckpoint.rulesProfileVersion,
        type,
        payload,
      },
      {
        actorUid: SCORER_UID,
        eventId: `compiled-noncanonical-checkpoint-${String(index)}`,
        serverTimestampMs: 1_800_000_302_000 + index,
      },
    );
    assert.equal(bounded.result.rejection?.code, "invalid-id");
    assert.strictEqual(bounded.checkpoint, canonicalCheckpoint);
  });
  assert.equal(
    canonicalIds.submit("record_plate_appearance", {
      batterId: "away-2\u0000",
      pitcherId: "home-1",
      result: "ground_out",
      batterAdvance: { to: "out", outKind: "batter_runner" },
      runnerAdvances: [],
      outsOnPlay: 1,
    }).result.rejection?.code,
    "invalid-id",
  );

  const unmarked = {
    ...superseded.ledger,
    initialState: structuredClone(superseded.ledger.initialState),
    state: structuredClone(superseded.ledger.state),
    events: structuredClone(superseded.ledger.events),
  };
  delete unmarked.initialState.lineups.home.courtesyRunnerIds;
  delete unmarked.initialState.lineups.away.courtesyRunnerIds;
  delete unmarked.state.lineups.home.courtesyRunnerIds;
  delete unmarked.state.lineups.away.courtesyRunnerIds;
  assert.throws(
    () => replayDiamondLedger(unmarked),
    (error) => error?.code === "history-required",
  );
  const blocked = executeDiamondCommand(
    unmarked,
    {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      commandId: "40000000-0000-4000-8000-000000000100",
      teamId: unmarked.teamId,
      gameId: unmarked.gameId,
      expectedRevision: unmarked.state.revision,
      rulesProfileId: unmarked.rulesProfileId,
      rulesProfileVersion: unmarked.rulesProfileVersion,
      type: "private_note",
      payload: { text: "Must not mutate an unmarked state." },
    },
    {
      actorUid: SCORER_UID,
      eventId: "compiled-unmarked-command",
      serverTimestampMs: 1_800_000_301_001,
    },
  );
  assert.equal(blocked.result.rejection?.code, "history-required");
  assert.strictEqual(blocked.ledger, unmarked);
});
