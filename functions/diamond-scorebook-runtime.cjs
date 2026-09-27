"use strict";

const {
  DiamondProjectorError,
} = require("./diamond-scorebook-projector-handlers.cjs");

const MAX_CLIP_CLOCK_MS = 24 * 60 * 60 * 1000;
const CLIP_LEAD_MS = 8_000;
const CLIP_TRAIL_MS = 12_000;

function exactString(value, maximum = 512) {
  return typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : "";
}

function timestampToMillis(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    return Number.isSafeInteger(milliseconds) && milliseconds >= 0
      ? milliseconds
      : null;
  }
  if (value && typeof value.toMillis === "function") {
    try {
      const milliseconds = value.toMillis();
      return Number.isSafeInteger(milliseconds) && milliseconds >= 0
        ? milliseconds
        : null;
    } catch {
      return null;
    }
  }
  if (value && typeof value.toDate === "function") {
    try {
      return timestampToMillis(value.toDate());
    } catch {
      return null;
    }
  }
  if (
    value &&
    Number.isSafeInteger(value.seconds) &&
    value.seconds >= 0 &&
    Number.isSafeInteger(value.nanoseconds ?? 0) &&
    (value.nanoseconds ?? 0) >= 0 &&
    (value.nanoseconds ?? 0) < 1_000_000_000
  ) {
    const milliseconds =
      value.seconds * 1000 + Math.floor((value.nanoseconds ?? 0) / 1_000_000);
    return Number.isSafeInteger(milliseconds) ? milliseconds : null;
  }
  if (typeof value === "string" && value === value.trim() && value) {
    const milliseconds = Date.parse(value);
    return Number.isSafeInteger(milliseconds) && milliseconds >= 0
      ? milliseconds
      : null;
  }
  return null;
}

function uniqueFiniteValue(values) {
  const normalized = [
    ...new Set(values.filter((value) => value !== null && value !== undefined)),
  ];
  return normalized.length === 1 ? normalized[0] : null;
}

function resolveStreamStartMillis(game) {
  return uniqueFiniteValue(
    [
      game?.liveStreamStartedAtMs,
      game?.liveStreamStartedAt,
      game?.liveStartedAt,
      game?.streamStartedAt,
    ].map(timestampToMillis),
  );
}

function resolveStreamOffsetMillis(game) {
  const candidates = [game?.liveStreamOffsetMs, game?.videoTimestampOffsetMs]
    .filter((value) => value !== null && value !== undefined)
    .map(Number);
  if (!candidates.length) return 0;
  if (
    candidates.some(
      (value) =>
        !Number.isSafeInteger(value) ||
        value < -MAX_CLIP_CLOCK_MS ||
        value > MAX_CLIP_CLOCK_MS,
    )
  ) {
    return null;
  }
  return uniqueFiniteValue(candidates);
}

async function loadDiamondClipTimings({ game = {}, ledger = {} } = {}) {
  const streamStartMs = resolveStreamStartMillis(game);
  const streamOffsetMs = resolveStreamOffsetMillis(game);
  if (
    streamStartMs === null ||
    streamOffsetMs === null ||
    !Array.isArray(ledger.events)
  ) {
    return {};
  }
  const timings = {};
  for (const event of ledger.events) {
    if (
      !exactString(event?.eventId, 128) ||
      !Number.isSafeInteger(event.serverTimestampMs)
    ) {
      continue;
    }
    const relativeMs = event.serverTimestampMs - streamStartMs + streamOffsetMs;
    if (relativeMs < 0 || relativeMs > MAX_CLIP_CLOCK_MS) continue;
    timings[event.eventId] = {
      startMs: Math.max(0, relativeMs - CLIP_LEAD_MS),
      endMs: relativeMs + CLIP_TRAIL_MS,
    };
  }
  return timings;
}

function normalizeSharedGamePath(value) {
  const path = exactString(value, 512);
  if (!path) return "";
  const segments = path.split("/");
  return segments.length === 4 &&
    ["organizations", "tournaments"].includes(segments[0]) &&
    segments[2] === "sharedGames" &&
    segments.every(
      (segment) =>
        segment && segment !== "." && segment !== ".." && segment.length <= 128,
    )
    ? path
    : "";
}

async function resolveDiamondSharedGame({ firestore, game = {} } = {}) {
  if (!firestore?.doc) {
    throw new TypeError("A Firestore document reader is required.");
  }
  const rawCandidates = [
    game.diamondSharedGamePath,
    game.sharedGamePath,
    game._sharedGamePath,
  ].filter((value) => value !== null && value !== undefined && value !== "");
  if (!rawCandidates.length) return null;
  const paths = [...new Set(rawCandidates.map(normalizeSharedGamePath))];
  if (paths.length !== 1 || !paths[0]) {
    throw new DiamondProjectorError(
      "invalid-shared-game",
      "The Diamond game has an ambiguous or invalid shared-game path.",
      { retryable: false },
    );
  }
  const path = paths[0];
  const ref = firestore.doc(path);
  let snapshot;
  try {
    snapshot = await ref.get();
  } catch (error) {
    throw new DiamondProjectorError(
      "shared-game-unavailable",
      "The linked shared game could not be read completely.",
      {
        retryable: true,
        details: { causeCode: error?.code || "read-failed" },
      },
    );
  }
  if (snapshot?.exists !== true || typeof snapshot.data !== "function") {
    throw new DiamondProjectorError(
      "shared-game-missing",
      "The explicitly linked shared game no longer exists.",
      { retryable: false },
    );
  }
  return { path, ref, data: snapshot.data() || {} };
}

module.exports = {
  CLIP_LEAD_MS,
  CLIP_TRAIL_MS,
  MAX_CLIP_CLOCK_MS,
  loadDiamondClipTimings,
  normalizeSharedGamePath,
  resolveDiamondSharedGame,
  resolveStreamOffsetMillis,
  resolveStreamStartMillis,
  timestampToMillis,
};
