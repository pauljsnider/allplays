const TERMINAL_STATES = new Set([
  "completed",
  "final",
  "correction",
  "cancelled",
  "canceled",
  "deleted",
]);
const MAX_CLIP_MS = 24 * 60 * 60 * 1000;

function compactText(value, maxLength = 256) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function boundedInteger(value, minimum, maximum, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function normalizeHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const raw = value.trim();
  try {
    const url = new URL(raw);
    const rawAuthority = raw.match(/^https:\/\/([^/?#]+)/i)?.[1] || "";
    if (
      url.protocol !== "https:" ||
      rawAuthority.toLowerCase() !== url.hostname.toLowerCase() ||
      url.username ||
      url.password ||
      url.port
    ) {
      return "";
    }
    return url.href;
  } catch {
    return "";
  }
}

function normalizeClipMs(value) {
  const raw =
    typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!/^\d{1,8}$/.test(raw)) return null;
  const milliseconds = Number(raw);
  return milliseconds <= MAX_CLIP_MS ? milliseconds : null;
}

export function normalizeDiamondViewerMode({
  replay = false,
  overlay = false,
  clipStart = null,
  clipEnd = null,
} = {}) {
  const clipStartMs = normalizeClipMs(clipStart);
  const clipEndMs = normalizeClipMs(clipEnd);
  const hasClip =
    clipStartMs !== null && clipEndMs !== null && clipEndMs > clipStartMs;
  return {
    replay: replay === true || replay === "true" || replay === "1" || hasClip,
    overlay: overlay === true || overlay === "true" || overlay === "1",
    clipStartMs: hasClip ? clipStartMs : null,
    clipEndMs: hasClip ? clipEndMs : null,
  };
}

export function normalizeDiamondPublicMedia(value = {}) {
  const media =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const publicUrl = normalizeHttpsUrl(media.publicUrl);
  const mode = compactText(media.mode, 16).toLowerCase();
  if (!publicUrl || !["live", "replay"].includes(mode)) return null;
  return {
    mode,
    publicUrl,
    durationMs: boundedInteger(media.durationMs, 0, MAX_CLIP_MS, 0),
  };
}

export function normalizeDiamondPublicState(value = {}) {
  const state =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const bases =
    state.bases &&
    typeof state.bases === "object" &&
    !Array.isArray(state.bases)
      ? state.bases
      : {};
  const half =
    compactText(state.half, 8).toLowerCase() === "bottom" ? "bottom" : "top";
  const status = compactText(state.status, 32).toLowerCase() || "scheduled";
  return {
    revision: boundedInteger(state.revision, 0, 10_000_000, 0),
    homeScore: boundedInteger(state.homeScore, 0, 999, 0),
    awayScore: boundedInteger(state.awayScore, 0, 999, 0),
    inning: boundedInteger(state.inning, 1, 99, 1),
    half,
    balls: boundedInteger(state.balls, 0, 3, 0),
    strikes: boundedInteger(state.strikes, 0, 2, 0),
    outs: boundedInteger(state.outs, 0, 2, 0),
    bases: {
      first: bases.first === true,
      second: bases.second === true,
      third: bases.third === true,
    },
    batterName: compactText(state.batterName, 80),
    pitcherName: compactText(state.pitcherName, 80),
    status,
    isFinal: TERMINAL_STATES.has(status),
    completeness: ["complete", "partial", "not_collected"].includes(
      state.completeness,
    )
      ? state.completeness
      : "partial",
  };
}

export function normalizeDiamondPublicGame(value = {}) {
  const game =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    teamName: compactText(game.teamName, 120) || "Home",
    opponent: compactText(game.opponent, 120) || "Opponent",
    startsAt: compactText(game.startsAt, 80),
    location: compactText(game.location, 160),
    trackingEngine: compactText(game.trackingEngine, 64),
    state: normalizeDiamondPublicState(game.state),
    media: normalizeDiamondPublicMedia(game.media),
    warnings: Array.isArray(game.warnings)
      ? game.warnings
          .map((warning) => compactText(warning, 240))
          .filter(Boolean)
          .slice(0, 10)
      : [],
  };
}

export function normalizeDiamondPublicEvent(value = {}) {
  const event =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const revision = boundedInteger(event.revision, 1, 10_000_000, 0);
  if (!revision) return null;
  return {
    id: compactText(event.id, 128) || `revision-${revision}`,
    revision,
    inning: boundedInteger(event.inning, 1, 99, 1),
    half:
      compactText(event.half, 8).toLowerCase() === "bottom" ? "bottom" : "top",
    description: compactText(event.description, 500) || "Scoring update",
    createdAt: compactText(event.createdAt, 80),
    isCorrection: event.isCorrection === true,
    isScoringPlay: event.isScoringPlay === true,
    score:
      event.score && typeof event.score === "object"
        ? {
            home: boundedInteger(event.score.home, 0, 999, 0),
            away: boundedInteger(event.score.away, 0, 999, 0),
          }
        : null,
  };
}

export function mergeDiamondEventPages(current, incoming) {
  const events = new Map();
  [
    ...(Array.isArray(current) ? current : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ]
    .map(normalizeDiamondPublicEvent)
    .filter(Boolean)
    .forEach((event) => events.set(event.id, event));
  return [...events.values()].sort(
    (left, right) => right.revision - left.revision,
  );
}

export function reconcileDiamondEventWindow({
  currentEvents = [],
  incomingEvents = [],
  previousSourceRevision = 0,
  sourceRevision = 0,
  previousProjectionToken = "",
  projectionToken = "",
  append = false,
} = {}) {
  const previousRevision = boundedInteger(
    previousSourceRevision,
    0,
    10_000_000,
    0,
  );
  const incomingRevision = boundedInteger(sourceRevision, 0, 10_000_000, 0);
  const projectionAdvanced = incomingRevision > previousRevision;
  const previousToken = compactText(previousProjectionToken, 256);
  const incomingToken = compactText(projectionToken, 256);
  const projectionRebuilt = Boolean(
    previousToken && incomingToken && previousToken !== incomingToken,
  );

  // A correction can remove a previously public play entirely. Once the
  // authoritative projection advances or replaces its same-revision
  // bootstrap, a fresh first page must replace the old window instead of
  // merging a now-voided play back into the replay.
  const baseEvents =
    !append && (projectionAdvanced || projectionRebuilt) ? [] : currentEvents;
  return {
    events: mergeDiamondEventPages(baseEvents, incomingEvents),
    projectionAdvanced,
    projectionRebuilt,
    sourceRevision: Math.max(previousRevision, incomingRevision),
    projectionToken: incomingToken || previousToken,
  };
}

export function reconcileDiamondPagination({
  previousSourceRevision = 0,
  sourceRevision = 0,
  previousProjectionToken = "",
  projectionToken = "",
  currentCursor = null,
  currentComplete = false,
  nextCursor = null,
  complete = false,
  append = false,
  hasLoadedGame = false,
} = {}) {
  const previousRevision = boundedInteger(
    previousSourceRevision,
    0,
    10_000_000,
    0,
  );
  const incomingRevision = boundedInteger(sourceRevision, 0, 10_000_000, 0);
  const previousToken = compactText(previousProjectionToken, 256);
  const incomingToken = compactText(projectionToken, 256);
  const sameLoadedProjection =
    !append &&
    hasLoadedGame === true &&
    previousRevision > 0 &&
    incomingRevision === previousRevision &&
    (!previousToken || !incomingToken || previousToken === incomingToken);
  if (sameLoadedProjection) {
    return {
      nextCursor: compactText(currentCursor, 256) || null,
      complete: currentComplete === true,
    };
  }
  return {
    nextCursor: compactText(nextCursor, 256) || null,
    complete: complete === true,
  };
}

export function formatDiamondInning(state) {
  const normalized = normalizeDiamondPublicState(state);
  return `${normalized.half === "bottom" ? "Bottom" : "Top"} ${normalized.inning}`;
}
