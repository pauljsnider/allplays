const TERMINAL_STATES = new Set([
  "completed",
  "final",
  "correction",
  "cancelled",
  "canceled",
  "deleted",
]);
const MAX_CLIP_MS = 24 * 60 * 60 * 1000;
const YOUTUBE_LIVE_CHANNEL_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const TWITCH_CHANNEL_PATTERN = /^[A-Za-z0-9_]{1,25}$/;
const YOUTUBE_LIVE_EMBED_HOSTS = new Set(["youtube.com", "www.youtube.com"]);
const TWITCH_CHANNEL_HOSTS = new Set(["twitch.tv", "www.twitch.tv"]);
const YOUTUBE_LIVE_QUERY_KEYS = new Set([
  "channel",
  "autoplay",
  "mute",
  "playsinline",
  "rel",
]);

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

function normalizeTwitchParentHostname(value) {
  if (typeof value !== "string") return "";
  const hostname = value.trim().toLowerCase();
  if (!hostname || hostname.length > 253) return "";
  const labels = hostname.split(".");
  if (
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    return "";
  }
  return hostname;
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

/**
 * Resolve only the two provider URL shapes that are safe to load as a live
 * iframe. Other credential-free HTTPS media remains available as an external
 * link, but is never promoted to executable embedded content here.
 */
export function resolveDiamondLiveMediaEmbed(
  value = {},
  { parentHostname = "" } = {},
) {
  const media = normalizeDiamondPublicMedia(value);
  if (!media || media.mode !== "live") return null;

  const source = new URL(media.publicUrl);
  const host = source.hostname.toLowerCase();
  if (
    YOUTUBE_LIVE_EMBED_HOSTS.has(host) &&
    /^\/embed\/live_stream\/?$/.test(source.pathname) &&
    !source.hash &&
    [...source.searchParams.keys()].every((key) =>
      YOUTUBE_LIVE_QUERY_KEYS.has(key),
    )
  ) {
    const channelIds = source.searchParams.getAll("channel");
    if (
      channelIds.length !== 1 ||
      !YOUTUBE_LIVE_CHANNEL_PATTERN.test(channelIds[0])
    ) {
      return null;
    }
    const channelId = channelIds[0];
    const embedUrl = new URL("https://www.youtube.com/embed/live_stream");
    embedUrl.searchParams.set("channel", channelId);
    embedUrl.searchParams.set("autoplay", "1");
    embedUrl.searchParams.set("mute", "1");
    embedUrl.searchParams.set("playsinline", "1");
    embedUrl.searchParams.set("rel", "0");
    return {
      provider: "youtube-live",
      embedUrl: embedUrl.toString(),
      publicUrl: `https://www.youtube.com/channel/${channelId}`,
    };
  }

  if (TWITCH_CHANNEL_HOSTS.has(host) && !source.search && !source.hash) {
    const channelMatch = source.pathname.match(/^\/([A-Za-z0-9_]{1,25})\/?$/);
    const parent = normalizeTwitchParentHostname(parentHostname);
    if (
      !channelMatch ||
      !TWITCH_CHANNEL_PATTERN.test(channelMatch[1]) ||
      !parent
    ) {
      return null;
    }
    const channel = channelMatch[1];
    const embedUrl = new URL("https://player.twitch.tv/");
    embedUrl.searchParams.set("channel", channel);
    embedUrl.searchParams.set("parent", parent);
    embedUrl.searchParams.set("autoplay", "true");
    embedUrl.searchParams.set("muted", "true");
    return {
      provider: "twitch",
      embedUrl: embedUrl.toString(),
      publicUrl: `https://www.twitch.tv/${channel}`,
    };
  }

  return null;
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
    // The canonical scorer intentionally holds terminal pitch/out evidence until
    // the separate plate-appearance or half-inning command is recorded.
    balls: boundedInteger(state.balls, 0, 4, 0),
    strikes: boundedInteger(state.strikes, 0, 3, 0),
    outs: boundedInteger(state.outs, 0, 3, 0),
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
