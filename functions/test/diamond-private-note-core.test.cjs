"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const domainEngine = require("../diamond-engine");
const privateNoteCore = require("../diamond-private-note-core.cjs");

const TEAM_ID = "team-private-note";
const GAME_ID = "game-private-note";
const AUTHOR_UID = "private-note-author";
const INSTANCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

test("Auth-deletion barrier IDs are domain-separated hashes of exact valid UIDs", () => {
  const uid = "deleted.user:1";
  const barrierId =
    privateNoteCore.buildDiamondPrivateNoteAuthDeleteBarrierId(uid);
  const bareUidHash = crypto.createHash("sha256").update(uid).digest("hex");

  assert.match(barrierId, /^[a-f0-9]{64}$/);
  assert.notEqual(barrierId, bareUidHash);
  assert.equal(
    barrierId,
    privateNoteCore.buildDiamondPrivateNoteAuthDeleteBarrierId(uid),
  );
  for (const invalid of [null, "", " padded", "bad/uid", "x".repeat(129)]) {
    assert.throws(
      () => privateNoteCore.buildDiamondPrivateNoteAuthDeleteBarrierId(invalid),
      TypeError,
    );
  }
});

function buildPrivateNoteFixture({ active = false } = {}) {
  let ledger = domainEngine.createDiamondLedger({
    teamId: TEAM_ID,
    gameId: GAME_ID,
    rulesProfileId: "baseball-youth",
    rulesProfileVersion: 1,
    captureMode: "full",
  });
  const activate = {
    schemaVersion: domainEngine.DIAMOND_SCHEMA_VERSION,
    commandId: uuid(1),
    teamId: TEAM_ID,
    gameId: GAME_ID,
    expectedRevision: 0,
    rulesProfileId: "baseball-youth",
    rulesProfileVersion: 1,
    type: "activate",
    payload: { initialScorerUid: AUTHOR_UID, captureMode: "full" },
  };
  ledger = domainEngine.executeDiamondCommand(ledger, activate, {
    actorUid: AUTHOR_UID,
    eventId: "event-activate",
    serverTimestampMs: 1,
    managerAuthorized: true,
  }).ledger;
  if (active) {
    const setup = [
      {
        type: "set_lineup",
        payload: {
          side: "home",
          entries: [
            { slot: 1, playerId: "home-1" },
            { slot: 2, playerId: "home-2" },
            { slot: 3, playerId: "home-3" },
          ],
        },
      },
      {
        type: "set_lineup",
        payload: {
          side: "away",
          entries: [
            { slot: 1, playerId: "away-1" },
            { slot: 2, playerId: "away-2" },
            { slot: 3, playerId: "away-3" },
          ],
        },
      },
      {
        type: "set_defensive_alignment",
        payload: {
          side: "home",
          assignments: [
            { playerId: "home-1", position: "P" },
            { playerId: "home-2", position: "C" },
            { playerId: "home-3", position: "SS" },
          ],
        },
      },
      {
        type: "set_defensive_alignment",
        payload: {
          side: "away",
          assignments: [
            { playerId: "away-1", position: "P" },
            { playerId: "away-2", position: "C" },
            { playerId: "away-3", position: "SS" },
          ],
        },
      },
      { type: "start", payload: {} },
    ];
    setup.forEach((entry, index) => {
      const setupExecution = domainEngine.executeDiamondCommand(
        ledger,
        {
          schemaVersion: domainEngine.DIAMOND_SCHEMA_VERSION,
          commandId: uuid(10 + index),
          teamId: TEAM_ID,
          gameId: GAME_ID,
          expectedRevision: ledger.state.revision,
          rulesProfileId: "baseball-youth",
          rulesProfileVersion: 1,
          type: entry.type,
          payload: entry.payload,
        },
        {
          actorUid: AUTHOR_UID,
          eventId: `event-setup-${index}`,
          serverTimestampMs: 10 + index,
          managerAuthorized: true,
        },
      );
      assert.equal(
        setupExecution.result.outcome,
        "accepted",
        setupExecution.result.rejection?.message,
      );
      ledger = setupExecution.ledger;
    });
  }
  const command = {
    schemaVersion: domainEngine.DIAMOND_SCHEMA_VERSION,
    commandId: uuid(2),
    teamId: TEAM_ID,
    gameId: GAME_ID,
    expectedRevision: ledger.state.revision,
    rulesProfileId: "baseball-youth",
    rulesProfileVersion: 1,
    type: "private_note",
    payload: {
      text: "Sensitive coaching note",
      attachedEventId: "event-public-1",
    },
  };
  const execution = domainEngine.executeDiamondCommand(ledger, command, {
    actorUid: AUTHOR_UID,
    eventId: "event-private-note",
    serverTimestampMs: 2,
    managerAuthorized: true,
  });
  assert.equal(
    execution.result.outcome,
    "accepted",
    execution.result.rejection?.message,
  );
  return { command, execution };
}

test("private-note records are the only source of plaintext and author identity", () => {
  const { command, execution } = buildPrivateNoteFixture();
  const serializedEvent = JSON.stringify(execution.event);
  assert.equal(serializedEvent.includes(command.payload.text), false);
  assert.equal(serializedEvent.includes(AUTHOR_UID), false);
  assert.equal(
    privateNoteCore.isCanonicalPrivateNoteEvent(execution.event, domainEngine),
    true,
  );

  const record = privateNoteCore.buildDiamondPrivateNoteRecord({
    command,
    event: execution.event,
    instanceId: INSTANCE_ID,
    authorUid: AUTHOR_UID,
    createdAt: "2026-09-09T10:00:00.000Z",
    domainEngine,
  });
  const hydrated = privateNoteCore.hydrateDiamondPrivateNoteEvent(
    execution.event,
    record,
    INSTANCE_ID,
    domainEngine,
  );
  assert.equal(hydrated.actorUid, AUTHOR_UID);
  assert.equal(
    hydrated.before.currentScorerUid,
    execution.event.before.currentScorerUid,
  );
  assert.equal(
    hydrated.after.currentScorerUid,
    execution.event.after.currentScorerUid,
  );
  assert.equal(
    hydrated.before.currentScorerUid,
    domainEngine.DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION,
  );
  assert.equal(
    hydrated.after.currentScorerUid,
    domainEngine.DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION,
  );
  assert.equal(hydrated.payload.text, command.payload.text);
  assert.equal(hydrated.payload.attachedEventId, "event-public-1");
});

test("redaction markers retain only fixed canonical deletion evidence", () => {
  const { execution } = buildPrivateNoteFixture();
  const redaction = privateNoteCore.buildDiamondPrivateNoteRedaction({
    event: execution.event,
    instanceId: INSTANCE_ID,
    redactedAt: "2026-09-09T12:00:00.000Z",
    domainEngine,
  });
  assert.doesNotThrow(() =>
    privateNoteCore.parseDiamondPrivateNoteRedaction(
      redaction,
      execution.event,
      INSTANCE_ID,
      domainEngine,
    ),
  );
  assert.equal(JSON.stringify(redaction).includes(AUTHOR_UID), false);
  assert.equal(JSON.stringify(redaction).includes("Sensitive coaching note"), false);
  assert.throws(() =>
    privateNoteCore.hydrateDiamondPrivateNoteEvent(
      execution.event,
      redaction,
      INSTANCE_ID,
      domainEngine,
    ),
  );
});

test("private-note corrections externalize their actor while discarding free-form reasons", () => {
  const { execution: noteExecution } = buildPrivateNoteFixture({ active: true });
  const command = {
    schemaVersion: domainEngine.DIAMOND_SCHEMA_VERSION,
    commandId: uuid(3),
    teamId: TEAM_ID,
    gameId: GAME_ID,
    expectedRevision: noteExecution.ledger.state.revision,
    rulesProfileId: "baseball-youth",
    rulesProfileVersion: 1,
    type: "void_event",
    payload: {
      targetEventId: noteExecution.event.eventId,
      reason: "This arbitrary reason must not remain",
    },
  };
  const execution = domainEngine.executeDiamondCommand(
    noteExecution.ledger,
    command,
    {
      actorUid: AUTHOR_UID,
      eventId: "event-private-note-void",
      serverTimestampMs: 3,
      managerAuthorized: true,
    },
  );
  assert.equal(
    execution.result.outcome,
    "accepted",
    execution.result.rejection?.message,
  );
  assert.equal(
    privateNoteCore.isCanonicalPrivateNoteMaterialEvent(
      execution.event,
      domainEngine,
    ),
    true,
  );
  assert.equal(
    execution.event.payload.reason,
    domainEngine.DIAMOND_PRIVATE_NOTE_REASON_TOMBSTONE,
  );
  assert.equal(JSON.stringify(execution.event).includes(command.payload.reason), false);

  const record = privateNoteCore.buildDiamondPrivateNoteRecord({
    command,
    event: execution.event,
    instanceId: INSTANCE_ID,
    authorUid: AUTHOR_UID,
    createdAt: "2026-09-09T10:01:00.000Z",
    domainEngine,
  });
  assert.equal(record.text, null);
  assert.match(record.requestHash, /^sha256:[a-f0-9]{64}$/);
});

test("private-note parsing rejects inline, mismatched, and path-ambiguous material", () => {
  const { command, execution } = buildPrivateNoteFixture();
  const record = privateNoteCore.buildDiamondPrivateNoteRecord({
    command,
    event: execution.event,
    instanceId: INSTANCE_ID,
    authorUid: AUTHOR_UID,
    createdAt: "2026-09-09T10:00:00.000Z",
    domainEngine,
  });
  const inlineEvent = {
    ...execution.event,
    payload: { ...execution.event.payload, text: command.payload.text },
  };
  assert.equal(
    privateNoteCore.isCanonicalPrivateNoteMaterialEvent(inlineEvent, domainEngine),
    false,
  );
  assert.throws(() =>
    privateNoteCore.parseDiamondPrivateNoteRecord(
      record,
      inlineEvent,
      INSTANCE_ID,
      domainEngine,
    ),
  );
  assert.throws(() =>
    privateNoteCore.parseDiamondPrivateNoteRecord(
      { ...record, eventId: "event-other" },
      execution.event,
      INSTANCE_ID,
      domainEngine,
    ),
  );

  const notePath = `teams/${TEAM_ID}/games/${GAME_ID}/diamondScorebooks/v2/notes/${execution.event.eventId}`;
  const eventPath = `teams/${TEAM_ID}/games/${GAME_ID}/diamondScorebooks/v2/events/${execution.event.eventId}`;
  assertPathIdentity(
    privateNoteCore.diamondPrivateNotePathsFromNotePath(notePath),
    execution.event.eventId,
  );
  assertPathIdentity(
    privateNoteCore.diamondPrivateNotePathsFromEventPath(eventPath),
    execution.event.eventId,
  );
  assert.equal(
    privateNoteCore.diamondPrivateNotePathsFromNotePath(
      `accounts/${AUTHOR_UID}/notes/${execution.event.eventId}`,
    ),
    null,
  );
});

function assertPathIdentity(paths, eventId) {
  const scorebook = `teams/${TEAM_ID}/games/${GAME_ID}/diamondScorebooks/v2`;
  assert.deepEqual(
    {
      teamId: paths.teamId,
      gameId: paths.gameId,
      eventId: paths.eventId,
      scorebook: paths.scorebook,
      event: paths.event,
      note: paths.note,
      privateProjection: paths.privateProjection,
    },
    {
    teamId: TEAM_ID,
    gameId: GAME_ID,
    eventId,
    scorebook,
    event: `${scorebook}/events/${eventId}`,
    note: `${scorebook}/notes/${eventId}`,
    privateProjection: `${scorebook}/projections/current`,
    },
  );
  assert.equal(paths.command(uuid(99)), `${scorebook}/commands/${uuid(99)}`);
}
