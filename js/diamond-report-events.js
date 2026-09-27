const DIAMOND_ENGINE = "diamond-v2";
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const PUBLIC_PAGE_SIZE = 200;
const MAX_EVENT_PAGES = 100;
const MAX_PRIVATE_EVENT_PAGES = MAX_EVENT_PAGES * 16;
const MAX_EVENTS = PUBLIC_PAGE_SIZE * MAX_EVENT_PAGES;
const MAX_PRIVATE_PAGE_BYTES = 1_000_000;
const MAX_PLAYER_SOURCE_IDS = 5_000;

const PUBLIC_RESPONSE_FIELDS = new Set([
  "instanceId",
  "game",
  "events",
  "nextCursor",
  "complete",
  "truncated",
  "sourceRevision",
  "projectionToken",
  "diamondStats",
]);
const PUBLIC_EVENT_FIELDS = new Set([
  "id",
  "revision",
  "inning",
  "half",
  "description",
  "createdAt",
  "isCorrection",
  "isScoringPlay",
  "score",
]);
const PRIVATE_PAGE_FIELDS = new Set([
  "sourceRevision",
  "items",
  "nextCursor",
  "complete",
  "accessComplete",
  "collectionComplete",
  "responseByteCount",
  "responseByteLimit",
]);
const PRIVATE_EVENT_FIELDS = new Set([
  "eventId",
  "sequence",
  "revision",
  "type",
  "payload",
  "serverTimestampMs",
  "createdAt",
  "voidsEventId",
  "supersedesEventId",
]);
const PRIVATE_EVENT_TYPES = new Set([
  "activate",
  "set_lineup",
  "set_defensive_alignment",
  "set_dp_flex",
  "start",
  "record_pitch",
  "record_plate_appearance",
  "advance_runner",
  "record_fielding",
  "record_scoring_judgment",
  "advance_half_inning",
  "place_tiebreaker_runner",
  "substitute",
  "re_enter",
  "add_courtesy_runner",
  "scorer_handoff",
  "private_note",
  "suspend",
  "resume",
  "cancel",
  "rules_decision",
  "void_event",
  "supersede_event",
  "reopen_for_correction",
  "finalize",
]);
const PRIVATE_PITCH_RESULTS = new Set([
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
]);
const PRIVATE_PLATE_APPEARANCE_RESULTS = new Set([
  "single",
  "double",
  "triple",
  "home_run",
  "walk",
  "intentional_walk",
  "hit_by_pitch",
  "strikeout",
  "reached_on_error",
  "fielders_choice",
  "sacrifice_bunt",
  "sacrifice_fly",
  "interference",
  "dropped_third_strike",
  "ground_out",
  "fly_out",
  "line_out",
  "double_play",
  "triple_play",
]);

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype,
  );
}

function requirePlainObject(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} was malformed.`);
  return value;
}

function requireAllowedFields(value, allowedFields, label) {
  if (Object.keys(value).some((key) => !allowedFields.has(key))) {
    throw new Error(`${label} contained unsupported data.`);
  }
}

function requireResourceId(value, label) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 128 || id.includes("/")) {
    throw new TypeError(
      `${label} must be nonempty, slash-free, and at most 128 characters.`,
    );
  }
  return id;
}

function requireInstanceId(value, label) {
  const instanceId = typeof value === "string" ? value.trim() : "";
  if (
    !UUID_V4_PATTERN.test(instanceId) ||
    instanceId !== instanceId.toLowerCase()
  ) {
    throw new Error(`${label} is unavailable.`);
  }
  return instanceId;
}

function requireRevision(value, label, { allowZero = false } = {}) {
  const revision = Number(value);
  if (
    !Number.isSafeInteger(revision) ||
    revision < (allowZero ? 0 : 1) ||
    revision > MAX_EVENTS
  ) {
    throw new Error(`${label} is unavailable.`);
  }
  return revision;
}

function requireEventId(value, label) {
  const eventId = typeof value === "string" ? value.trim() : "";
  if (!eventId || eventId.length > 128 || eventId.includes("/")) {
    throw new Error(`${label} contained an invalid event ID.`);
  }
  return eventId;
}

function normalizeSourcePlayIds(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_PLAYER_SOURCE_IDS) {
    throw new Error("The Diamond player play evidence is malformed.");
  }
  const ids = value.map((eventId) =>
    requireEventId(eventId, "The Diamond player play evidence"),
  );
  if (new Set(ids).size !== ids.length) {
    throw new Error(
      "The Diamond player play evidence contains duplicate event IDs.",
    );
  }
  return new Set(ids);
}

function normalizeTimestamp(createdAt, serverTimestampMs = null) {
  let timestampMs = null;
  if (serverTimestampMs !== null && serverTimestampMs !== undefined) {
    timestampMs = Number(serverTimestampMs);
    if (
      !Number.isSafeInteger(timestampMs) ||
      timestampMs < 0 ||
      timestampMs > 8_640_000_000_000_000
    ) {
      throw new Error("The Diamond replay contains an invalid timestamp.");
    }
  }
  if (createdAt !== null && createdAt !== undefined && createdAt !== "") {
    if (
      typeof createdAt !== "string" ||
      createdAt.length > 64 ||
      !ISO_TIMESTAMP_PATTERN.test(createdAt)
    ) {
      throw new Error("The Diamond replay contains an invalid timestamp.");
    }
    const parsed = Date.parse(createdAt);
    if (
      !Number.isFinite(parsed) ||
      (timestampMs !== null && parsed !== timestampMs)
    ) {
      throw new Error(
        "The Diamond replay contains inconsistent timestamp evidence.",
      );
    }
    timestampMs = parsed;
  }
  if (timestampMs === null) return null;
  return Object.freeze({
    seconds: Math.floor(timestampMs / 1000),
    nanoseconds: Math.floor((timestampMs % 1000) * 1_000_000),
  });
}

function serializedUtf8Bytes(value, label) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new Error(`${label} was not valid bounded JSON.`);
  }
}

function requireInvoker(invoke) {
  if (typeof invoke !== "function") {
    throw new TypeError("A Diamond callable invoker is required.");
  }
  return invoke;
}

function callableErrorCode(error) {
  return String(error?.code || "")
    .trim()
    .toLowerCase()
    .replace(/^functions\//, "");
}

function isNotFoundError(error) {
  return callableErrorCode(error) === "not-found";
}

function normalizePublicEvent(value, sourceRevision) {
  const event = requirePlainObject(value, "The Diamond public replay event");
  requireAllowedFields(
    event,
    PUBLIC_EVENT_FIELDS,
    "The Diamond public replay event",
  );
  const id = requireEventId(event.id, "The Diamond public replay");
  const revision = requireRevision(
    event.revision,
    "The Diamond public replay revision",
  );
  const inning = Number(event.inning);
  const half =
    typeof event.half === "string" ? event.half.trim().toLowerCase() : "";
  const description =
    typeof event.description === "string" ? event.description.trim() : "";
  if (
    revision > sourceRevision ||
    !Number.isSafeInteger(inning) ||
    inning < 1 ||
    inning > 99 ||
    !["top", "bottom"].includes(half) ||
    !description ||
    description.length > 500
  ) {
    throw new Error(
      "The Diamond public replay contains malformed play evidence.",
    );
  }
  return Object.freeze({
    id,
    text: description,
    period: `${half === "bottom" ? "Bottom" : "Top"} ${String(inning)}`,
    clock: "",
    gameTime: "",
    timestamp: normalizeTimestamp(event.createdAt),
    revision,
  });
}

function normalizeCursor(value, label) {
  if (value === null || value === undefined || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} returned an invalid continuation cursor.`);
  }
  return value;
}

function requireRequestedSourcePlayIds(sourcePlayIds, matchedIds, label) {
  if (sourcePlayIds === null) return;
  for (const sourcePlayId of sourcePlayIds) {
    if (!matchedIds.has(sourcePlayId)) {
      throw new Error(`${label} omitted requested play evidence.`);
    }
  }
}

async function loadPublicEvents({
  teamId,
  gameId,
  instanceId,
  sourceRevision,
  sourcePlayIds,
  invoke,
}) {
  const events = [];
  const eventIds = new Set();
  const seenCursors = new Set();
  let cursor = null;
  let projectionToken = "";

  for (let pageNumber = 0; pageNumber < MAX_EVENT_PAGES; pageNumber += 1) {
    const page = requirePlainObject(
      await invoke("getPublicDiamondGame", {
        teamId,
        gameId,
        cursor,
        limit: PUBLIC_PAGE_SIZE,
      }),
      "The Diamond public replay response",
    );
    requireAllowedFields(
      page,
      PUBLIC_RESPONSE_FIELDS,
      "The Diamond public replay response",
    );
    const responseInstanceId = requireInstanceId(
      page.instanceId,
      "The Diamond public replay identity",
    );
    const responseRevision = requireRevision(
      page.sourceRevision,
      "The Diamond public replay revision",
    );
    const nextCursor = normalizeCursor(
      page.nextCursor,
      "The Diamond public replay",
    );
    const nextProjectionToken =
      typeof page.projectionToken === "string"
        ? page.projectionToken.trim()
        : "";
    const pageEvents = Array.isArray(page.events) ? page.events : null;
    if (
      responseInstanceId !== instanceId ||
      responseRevision !== sourceRevision ||
      !nextProjectionToken ||
      nextProjectionToken.length > 256 ||
      (projectionToken && nextProjectionToken !== projectionToken) ||
      !pageEvents ||
      pageEvents.length > PUBLIC_PAGE_SIZE ||
      !isPlainObject(page.game) ||
      page.game.trackingEngine !== DIAMOND_ENGINE ||
      (page.complete === true &&
        (page.truncated === true || nextCursor !== null)) ||
      (page.complete !== true &&
        (page.truncated !== true ||
          nextCursor === null ||
          pageEvents.length === 0))
    ) {
      throw new Error(
        "The Diamond public replay is incomplete or changed while loading.",
      );
    }
    projectionToken = nextProjectionToken;
    pageEvents.forEach((value) => {
      const event = normalizePublicEvent(value, sourceRevision);
      if (eventIds.has(event.id)) {
        throw new Error(
          "The Diamond public replay contains duplicate play evidence.",
        );
      }
      eventIds.add(event.id);
      events.push(event);
    });
    if (page.complete === true) {
      requireRequestedSourcePlayIds(
        sourcePlayIds,
        eventIds,
        "The Diamond public replay",
      );
      return events
        .filter(
          (event) => sourcePlayIds === null || sourcePlayIds.has(event.id),
        )
        .sort((left, right) => left.revision - right.revision);
    }
    if (seenCursors.has(nextCursor)) {
      throw new Error(
        "The Diamond public replay repeated a continuation cursor.",
      );
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new Error(
    "The Diamond public replay exceeds the supported report limit.",
  );
}

function normalizePrivateEvent(value, sourceRevision, expectedSequence) {
  const event = requirePlainObject(value, "The Diamond private replay event");
  requireAllowedFields(
    event,
    PRIVATE_EVENT_FIELDS,
    "The Diamond private replay event",
  );
  const eventId = requireEventId(event.eventId, "The Diamond private replay");
  const sequence = requireRevision(
    event.sequence,
    "The Diamond private replay sequence",
  );
  const revision = requireRevision(
    event.revision,
    "The Diamond private replay revision",
  );
  const type = typeof event.type === "string" ? event.type.trim() : "";
  if (
    sequence !== expectedSequence ||
    revision !== sequence ||
    revision > sourceRevision ||
    !PRIVATE_EVENT_TYPES.has(type)
  ) {
    throw new Error(
      "The Diamond private replay contains invalid sequence evidence.",
    );
  }
  const payload = requirePlainObject(
    event.payload || {},
    "The Diamond private replay payload",
  );
  const voidsEventId =
    event.voidsEventId == null || event.voidsEventId === ""
      ? null
      : requireEventId(
          event.voidsEventId,
          "The Diamond private replay void target",
        );
  const supersedesEventId =
    event.supersedesEventId == null || event.supersedesEventId === ""
      ? null
      : requireEventId(
          event.supersedesEventId,
          "The Diamond private replay supersede target",
        );
  return Object.freeze({
    eventId,
    sequence,
    revision,
    type,
    payload,
    voidsEventId,
    supersedesEventId,
    timestamp: normalizeTimestamp(event.createdAt, event.serverTimestampMs),
  });
}

function resolveEffectivePrivateEvents(events) {
  const priorEventIds = new Set();
  const directives = new Map();
  events.forEach((event) => {
    if (priorEventIds.has(event.eventId)) {
      throw new Error(
        "The Diamond private replay contains duplicate play evidence.",
      );
    }
    if (event.type === "void_event" || event.type === "supersede_event") {
      const targetEventId = requireEventId(
        event.payload.targetEventId,
        "The Diamond private replay correction",
      );
      if (!priorEventIds.has(targetEventId) || directives.has(targetEventId)) {
        throw new Error(
          "The Diamond private replay contains invalid correction evidence.",
        );
      }
      if (event.type === "void_event") {
        if (
          event.voidsEventId !== targetEventId ||
          event.supersedesEventId !== null
        ) {
          throw new Error(
            "The Diamond private replay contains inconsistent correction evidence.",
          );
        }
        directives.set(targetEventId, { kind: "void", correction: event });
      } else {
        const replacement = requirePlainObject(
          event.payload.replacement,
          "The Diamond private replay replacement",
        );
        const replacementType =
          typeof replacement.type === "string" ? replacement.type.trim() : "";
        const replacementPayload = requirePlainObject(
          replacement.payload || {},
          "The Diamond private replay replacement payload",
        );
        if (
          event.supersedesEventId !== targetEventId ||
          event.voidsEventId !== null ||
          !PRIVATE_EVENT_TYPES.has(replacementType) ||
          ["private_note", "void_event", "supersede_event"].includes(
            replacementType,
          )
        ) {
          throw new Error(
            "The Diamond private replay contains inconsistent replacement evidence.",
          );
        }
        directives.set(targetEventId, {
          kind: "supersede",
          correction: event,
          replacement: { type: replacementType, payload: replacementPayload },
        });
      }
    }
    priorEventIds.add(event.eventId);
  });

  const voidedEventIds = new Set(
    [...directives.entries()]
      .filter(([, directive]) => directive.kind === "void")
      .map(([eventId]) => eventId),
  );
  return events.flatMap((event) => {
    if (
      event.type === "private_note" ||
      event.type === "void_event" ||
      event.type === "supersede_event"
    )
      return [];
    if (
      ["record_fielding", "record_scoring_judgment"].includes(event.type) &&
      voidedEventIds.has(String(event.payload.playEventId || "").trim())
    )
      return [];
    const directive = directives.get(event.eventId);
    if (directive?.kind === "void") return [];
    if (directive?.kind === "supersede") {
      return [
        {
          eventId: directive.correction.eventId,
          sourceEventId: event.eventId,
          revision: event.revision,
          type: directive.replacement.type,
          payload: directive.replacement.payload,
          timestamp: directive.correction.timestamp || event.timestamp,
        },
      ];
    }
    return [{ ...event, sourceEventId: event.eventId }];
  });
}

function describePrivateEvent(event) {
  const payload = isPlainObject(event.payload) ? event.payload : {};
  const rawResult =
    typeof payload.result === "string" ? payload.result.trim() : "";
  const acceptedResults =
    event.type === "record_pitch"
      ? PRIVATE_PITCH_RESULTS
      : event.type === "record_plate_appearance"
        ? PRIVATE_PLATE_APPEARANCE_RESULTS
        : null;
  const result = acceptedResults?.has(rawResult)
    ? rawResult.replace(/_/g, " ")
    : "";
  const side =
    payload.side === "away" ? "Away" : payload.side === "home" ? "Home" : "";
  const labels = {
    activate: "Scorebook ready",
    set_lineup: `${side || "Team"} lineup set`,
    set_defensive_alignment: `${side || "Team"} defense set`,
    set_dp_flex: `${side || "Team"} DP/FLEX set`,
    start: "Game started",
    record_pitch: result ? `Pitch: ${result}` : "Pitch recorded",
    record_plate_appearance: result
      ? `Plate appearance: ${result}`
      : "Plate appearance recorded",
    advance_runner: "Runner advance recorded",
    record_fielding: "Fielding details recorded",
    record_scoring_judgment: "Official scoring updated",
    advance_half_inning: "Half inning advanced",
    place_tiebreaker_runner: "Tiebreaker runner placed",
    substitute: "Substitution recorded",
    re_enter: "Re-entry recorded",
    add_courtesy_runner: "Courtesy runner recorded",
    scorer_handoff: "Official scorer changed",
    suspend: "Game suspended",
    resume: "Game resumed",
    cancel: "Game cancelled",
    rules_decision: "Rules decision recorded",
    reopen_for_correction: "Scorebook reopened for correction",
    finalize: "Game final",
  };
  return labels[event.type] || "Game update";
}

function sanitizePrivateEvent(event) {
  return Object.freeze({
    id: event.eventId,
    text: describePrivateEvent(event),
    period: `Revision ${String(event.revision)}`,
    clock: "",
    gameTime: "",
    timestamp: event.timestamp,
    revision: event.revision,
  });
}

function requirePrivateState(value, instanceId, sourceRevision, label) {
  const state = requirePlainObject(value, label);
  if (
    state.authoritative !== true ||
    requireInstanceId(state.instanceId, `${label} identity`) !== instanceId ||
    requireRevision(state.revision, `${label} revision`) !== sourceRevision ||
    state.trackingEngine !== DIAMOND_ENGINE
  ) {
    throw new Error(`${label} changed while loading.`);
  }
}

async function loadManagerEvents({
  teamId,
  gameId,
  instanceId,
  sourceRevision,
  sourcePlayIds,
  invoke,
}) {
  requirePrivateState(
    await invoke("getDiamondState", { teamId, gameId, visibility: "private" }),
    instanceId,
    sourceRevision,
    "The Diamond manager replay",
  );

  const events = [];
  const eventIds = new Set();
  let cursor = null;
  let expectedSequence = 1;
  for (
    let pageNumber = 0;
    pageNumber < MAX_PRIVATE_EVENT_PAGES;
    pageNumber += 1
  ) {
    const page = requirePlainObject(
      await invoke("listDiamondEvents", {
        teamId,
        gameId,
        visibility: "private",
        limit: PUBLIC_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      }),
      "The Diamond private replay response",
    );
    requireAllowedFields(
      page,
      PRIVATE_PAGE_FIELDS,
      "The Diamond private replay response",
    );
    if (
      serializedUtf8Bytes(page, "The Diamond private replay response") !==
        page.responseByteCount ||
      page.responseByteLimit !== MAX_PRIVATE_PAGE_BYTES ||
      !Number.isSafeInteger(page.responseByteCount) ||
      page.responseByteCount > page.responseByteLimit ||
      requireRevision(
        page.sourceRevision,
        "The Diamond private replay revision",
      ) !== sourceRevision ||
      page.complete !== true ||
      page.accessComplete !== true ||
      !Array.isArray(page.items) ||
      page.items.length > PUBLIC_PAGE_SIZE
    ) {
      throw new Error("The Diamond private replay is incomplete or malformed.");
    }
    page.items.forEach((value) => {
      const event = normalizePrivateEvent(
        value,
        sourceRevision,
        expectedSequence,
      );
      if (eventIds.has(event.eventId)) {
        throw new Error(
          "The Diamond private replay contains duplicate play evidence.",
        );
      }
      eventIds.add(event.eventId);
      events.push(event);
      expectedSequence += 1;
    });
    const nextCursor = normalizeCursor(
      page.nextCursor,
      "The Diamond private replay",
    );
    if (
      page.collectionComplete !== (nextCursor === null) ||
      (nextCursor !== null &&
        (page.items.length === 0 ||
          nextCursor !== String(expectedSequence - 1)))
    ) {
      throw new Error(
        "The Diamond private replay returned inconsistent completeness evidence.",
      );
    }
    if (page.collectionComplete === true) {
      if (expectedSequence - 1 !== sourceRevision) {
        throw new Error("The Diamond private replay is incomplete.");
      }
      requirePrivateState(
        await invoke("getDiamondState", {
          teamId,
          gameId,
          visibility: "private",
        }),
        instanceId,
        sourceRevision,
        "The Diamond manager replay",
      );
      const effectiveEvents = resolveEffectivePrivateEvents(events);
      const matchedIds = new Set(
        effectiveEvents.flatMap((event) => [
          event.eventId,
          event.sourceEventId,
        ]),
      );
      requireRequestedSourcePlayIds(
        sourcePlayIds,
        matchedIds,
        "The Diamond manager replay",
      );
      return effectiveEvents
        .filter(
          (event) =>
            sourcePlayIds === null ||
            sourcePlayIds.has(event.eventId) ||
            sourcePlayIds.has(event.sourceEventId),
        )
        .map(sanitizePrivateEvent)
        .sort((left, right) => left.revision - right.revision);
    }
    cursor = nextCursor;
  }
  throw new Error(
    "The Diamond manager replay exceeds the supported report limit.",
  );
}

/**
 * Loads complete report-safe Diamond play evidence without reading the raw
 * Firestore event collection. Public pages consume the public projection;
 * authorized managers may fall back to bounded private summaries, which are
 * reduced and sanitized before this helper returns them.
 */
export async function loadCompleteDiamondReportEvents({
  teamId,
  gameId,
  game,
  requestedVisibility = "public",
  sourcePlayIds,
  invoke,
} = {}) {
  const normalizedTeamId = requireResourceId(teamId, "Team ID");
  const normalizedGameId = requireResourceId(gameId, "Game ID");
  if (!isPlainObject(game) || game.trackingEngine !== DIAMOND_ENGINE) {
    throw new TypeError("A Diamond game is required.");
  }
  if (!["public", "manager-internal"].includes(requestedVisibility)) {
    throw new TypeError("The Diamond replay visibility is invalid.");
  }
  const instanceId = requireInstanceId(
    game.diamondScorebookInstanceId,
    "The Diamond replay identity",
  );
  const sourceRevision = requireRevision(
    game.diamondProjectionRevision,
    "The Diamond replay revision",
  );
  const allowedSourcePlayIds = normalizeSourcePlayIds(sourcePlayIds);
  const call = requireInvoker(invoke);
  try {
    return Object.freeze({
      events: Object.freeze(
        await loadPublicEvents({
          teamId: normalizedTeamId,
          gameId: normalizedGameId,
          instanceId,
          sourceRevision,
          sourcePlayIds: allowedSourcePlayIds,
          invoke: call,
        }),
      ),
      requestedVisibility,
      visibility: "public",
      source: "public-sanitized",
    });
  } catch (error) {
    if (requestedVisibility !== "manager-internal" || !isNotFoundError(error))
      throw error;
    return Object.freeze({
      events: Object.freeze(
        await loadManagerEvents({
          teamId: normalizedTeamId,
          gameId: normalizedGameId,
          instanceId,
          sourceRevision,
          sourcePlayIds: allowedSourcePlayIds,
          invoke: call,
        }),
      ),
      requestedVisibility,
      visibility: "manager-internal",
      source: "manager-private-sanitized",
    });
  }
}
