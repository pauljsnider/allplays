"use strict";

const crypto = require("node:crypto");

const DIAMOND_ENGINE = "diamond-v2";
const PRIVATE_NOTE_SCHEMA_VERSION = 1;
const PRIVATE_NOTE_REDACTION_SCHEMA_VERSION = 1;
const MAX_PRIVATE_NOTE_TEXT_LENGTH = 2_000;
const MAX_PRIVATE_NOTE_DOCUMENT_BYTES = 16 * 1024;
const AUTH_DELETE_BARRIER_HASH_DOMAIN =
  "diamond-private-note-auth-delete-barrier:v1\0";
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SCOREBOOK_EVENT_PATH_PATTERN =
  /^teams\/([^/]+)\/games\/([^/]+)\/diamondScorebooks\/v2\/events\/([^/]+)$/;
const SCOREBOOK_NOTE_PATH_PATTERN =
  /^teams\/([^/]+)\/games\/([^/]+)\/diamondScorebooks\/v2\/notes\/([^/]+)$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isCanonicalId(value) {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= 128 &&
    !value.includes("/")
  );
}

function buildDiamondPrivateNoteAuthDeleteBarrierId(uid) {
  if (!isCanonicalId(uid)) {
    throw new TypeError("The Diamond private-note deletion principal is invalid.");
  }
  return crypto
    .createHash("sha256")
    .update(AUTH_DELETE_BARRIER_HASH_DOMAIN)
    .update(uid)
    .digest("hex");
}

function isIsoTimestamp(value) {
  if (typeof value !== "string" || value.length < 20 || value.length > 40) {
    return false;
  }
  try {
    return new Date(value).toISOString() === value;
  } catch (_error) {
    return false;
  }
}

function privateNotePayload(event) {
  if (!isPlainObject(event)) return null;
  if (event.type === "private_note" && isPlainObject(event.payload)) {
    return event.payload;
  }
  if (
    event.type === "supersede_event" &&
    isPlainObject(event.payload?.replacement) &&
    event.payload.replacement.type === "private_note" &&
    isPlainObject(event.payload.replacement.payload)
  ) {
    return event.payload.replacement.payload;
  }
  return null;
}

function isCanonicalPrivateNoteMaterialEvent(event, domainEngine) {
  if (
    !isPlainObject(event) ||
    !isPlainObject(event.payload) ||
    !isPlainObject(event.before) ||
    !isPlainObject(event.after) ||
    !isPlainObject(domainEngine)
  ) {
    return false;
  }
  const payload = privateNotePayload(event);
  const correction = ["void_event", "supersede_event"].includes(event?.type);
  return Boolean(
    (payload || correction) &&
      (!payload ||
        payload.text === domainEngine.DIAMOND_PRIVATE_NOTE_TOMBSTONE) &&
      event.actorUid === domainEngine.DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION &&
      event.before?.currentScorerUid ===
        domainEngine.DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION &&
      event.after?.currentScorerUid ===
        domainEngine.DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION &&
      (!correction ||
        event.payload.reason ===
          domainEngine.DIAMOND_PRIVATE_NOTE_REASON_TOMBSTONE),
  );
}

function isCanonicalPrivateNoteEvent(event, domainEngine) {
  return Boolean(
    privateNotePayload(event) &&
      isCanonicalPrivateNoteMaterialEvent(event, domainEngine),
  );
}

function privateNoteTextFromCommand(command, domainEngine) {
  const text = domainEngine.getDiamondPrivateNoteText(command);
  if (
    text === null &&
    ["void_event", "supersede_event"].includes(command?.type)
  ) {
    return null;
  }
  if (
    typeof text !== "string" ||
    !text.trim() ||
    text.length > MAX_PRIVATE_NOTE_TEXT_LENGTH
  ) {
    throw new TypeError("The private-note source text is invalid.");
  }
  return text;
}

function buildDiamondPrivateNoteRecord({
  command,
  event,
  instanceId,
  authorUid,
  createdAt,
  domainEngine,
}) {
  const text = privateNoteTextFromCommand(command, domainEngine);
  const requestHash = domainEngine.getDiamondPrivateNoteRequestHash(command);
  if (
    !isCanonicalPrivateNoteMaterialEvent(event, domainEngine) ||
    !isCanonicalId(instanceId) ||
    !isCanonicalId(authorUid) ||
    !isCanonicalId(event.eventId) ||
    !isCanonicalId(event.commandId) ||
    !Number.isSafeInteger(event.revision) ||
    event.revision < 1 ||
    !isIsoTimestamp(createdAt) ||
    event.commandId !== command.commandId ||
    !SHA256_PATTERN.test(requestHash || "")
  ) {
    throw new TypeError("The private-note record identity is invalid.");
  }
  const record = {
    schemaVersion: PRIVATE_NOTE_SCHEMA_VERSION,
    trackingEngine: DIAMOND_ENGINE,
    instanceId,
    eventId: event.eventId,
    commandId: event.commandId,
    revision: event.revision,
    authorUid,
    requestHash,
    text,
    createdAt,
  };
  if (
    Buffer.byteLength(JSON.stringify(record), "utf8") >
    MAX_PRIVATE_NOTE_DOCUMENT_BYTES
  ) {
    throw new TypeError("The private-note record is too large.");
  }
  return Object.freeze(record);
}

function parseDiamondPrivateNoteRecord(value, event, instanceId, domainEngine) {
  const expectedKeys = [
    "authorUid",
    "commandId",
    "createdAt",
    "eventId",
    "instanceId",
    "requestHash",
    "revision",
    "schemaVersion",
    "text",
    "trackingEngine",
  ].sort();
  if (
    !exactKeys(value, expectedKeys) ||
    Buffer.byteLength(JSON.stringify(value), "utf8") >
      MAX_PRIVATE_NOTE_DOCUMENT_BYTES ||
    value.schemaVersion !== PRIVATE_NOTE_SCHEMA_VERSION ||
    value.trackingEngine !== DIAMOND_ENGINE ||
    value.instanceId !== instanceId ||
    value.eventId !== event?.eventId ||
    value.commandId !== event?.commandId ||
    value.revision !== event?.revision ||
    !isCanonicalId(value.eventId) ||
    !isCanonicalId(value.commandId) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !isCanonicalId(value.authorUid) ||
    !SHA256_PATTERN.test(value.requestHash || "") ||
    !isIsoTimestamp(value.createdAt) ||
    !(
      value.text === null ||
      (typeof value.text === "string" &&
        value.text.trim().length > 0 &&
        value.text.length <= MAX_PRIVATE_NOTE_TEXT_LENGTH)
    ) ||
    Boolean(privateNotePayload(event)) !== (typeof value.text === "string") ||
    !isCanonicalPrivateNoteMaterialEvent(event, domainEngine)
  ) {
    throw new TypeError("The private-note record is malformed or mismatched.");
  }
  return Object.freeze({ ...value });
}

function buildDiamondPrivateNoteRedaction({
  event,
  instanceId,
  redactedAt,
  domainEngine,
}) {
  if (
    !isCanonicalPrivateNoteMaterialEvent(event, domainEngine) ||
    !isCanonicalId(instanceId) ||
    !isCanonicalId(event.eventId) ||
    !isCanonicalId(event.commandId) ||
    !Number.isSafeInteger(event.revision) ||
    event.revision < 1 ||
    !isIsoTimestamp(redactedAt)
  ) {
    throw new TypeError("The private-note redaction identity is invalid.");
  }
  return Object.freeze({
    schemaVersion: PRIVATE_NOTE_REDACTION_SCHEMA_VERSION,
    trackingEngine: DIAMOND_ENGINE,
    status: "deleted",
    reason: "account-deletion",
    instanceId,
    eventId: event.eventId,
    commandId: event.commandId,
    revision: event.revision,
    redactedAt,
  });
}

function parseDiamondPrivateNoteRedaction(
  value,
  event,
  instanceId,
  domainEngine,
) {
  const expectedKeys = [
    "commandId",
    "eventId",
    "instanceId",
    "reason",
    "redactedAt",
    "revision",
    "schemaVersion",
    "status",
    "trackingEngine",
  ].sort();
  if (
    !exactKeys(value, expectedKeys) ||
    Buffer.byteLength(JSON.stringify(value), "utf8") >
      MAX_PRIVATE_NOTE_DOCUMENT_BYTES ||
    value.schemaVersion !== PRIVATE_NOTE_REDACTION_SCHEMA_VERSION ||
    value.trackingEngine !== DIAMOND_ENGINE ||
    value.status !== "deleted" ||
    value.reason !== "account-deletion" ||
    value.instanceId !== instanceId ||
    value.eventId !== event?.eventId ||
    value.commandId !== event?.commandId ||
    value.revision !== event?.revision ||
    !isCanonicalId(value.eventId) ||
    !isCanonicalId(value.commandId) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !isIsoTimestamp(value.redactedAt) ||
    !isCanonicalPrivateNoteMaterialEvent(event, domainEngine)
  ) {
    throw new TypeError("The private-note redaction is malformed or mismatched.");
  }
  return Object.freeze({ ...value });
}

function hydrateDiamondPrivateNoteEvent(
  event,
  record,
  instanceId,
  domainEngine,
) {
  const parsed = parseDiamondPrivateNoteRecord(
    record,
    event,
    instanceId,
    domainEngine,
  );
  const hydratedEvent = {
    ...event,
    actorUid: parsed.authorUid,
  };
  if (event.type === "private_note") {
    return Object.freeze({
      ...hydratedEvent,
      payload: Object.freeze({ ...event.payload, text: parsed.text }),
    });
  }
  if (!privateNotePayload(event)) {
    return Object.freeze({
      ...hydratedEvent,
      payload: Object.freeze({
        ...event.payload,
      }),
    });
  }
  return Object.freeze({
    ...hydratedEvent,
    payload: Object.freeze({
      ...event.payload,
      replacement: Object.freeze({
        ...event.payload.replacement,
        payload: Object.freeze({
          ...event.payload.replacement.payload,
          text: parsed.text,
        }),
      }),
    }),
  });
}

function pathsFromMatch(match) {
  if (!match) return null;
  const [, teamId, gameId, eventId] = match;
  if (![teamId, gameId, eventId].every(isCanonicalId)) return null;
  const scorebook = `teams/${teamId}/games/${gameId}/diamondScorebooks/v2`;
  return Object.freeze({
    teamId,
    gameId,
    eventId,
    scorebook,
    event: `${scorebook}/events/${eventId}`,
    command: (commandId) => `${scorebook}/commands/${commandId}`,
    note: `${scorebook}/notes/${eventId}`,
    privateProjection: `${scorebook}/projections/current`,
  });
}

function diamondPrivateNotePathsFromEventPath(eventPath) {
  return pathsFromMatch(
    SCOREBOOK_EVENT_PATH_PATTERN.exec(
      typeof eventPath === "string" ? eventPath : "",
    ),
  );
}

function diamondPrivateNotePathsFromNotePath(notePath) {
  return pathsFromMatch(
    SCOREBOOK_NOTE_PATH_PATTERN.exec(
      typeof notePath === "string" ? notePath : "",
    ),
  );
}

module.exports = {
  DIAMOND_ENGINE,
  MAX_PRIVATE_NOTE_DOCUMENT_BYTES,
  MAX_PRIVATE_NOTE_TEXT_LENGTH,
  PRIVATE_NOTE_REDACTION_SCHEMA_VERSION,
  PRIVATE_NOTE_SCHEMA_VERSION,
  buildDiamondPrivateNoteAuthDeleteBarrierId,
  buildDiamondPrivateNoteRecord,
  buildDiamondPrivateNoteRedaction,
  diamondPrivateNotePathsFromEventPath,
  diamondPrivateNotePathsFromNotePath,
  hydrateDiamondPrivateNoteEvent,
  isCanonicalPrivateNoteEvent,
  isCanonicalPrivateNoteMaterialEvent,
  parseDiamondPrivateNoteRecord,
  parseDiamondPrivateNoteRedaction,
  privateNotePayload,
};
