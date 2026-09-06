import { functions, httpsCallable } from "./firebase.js?v=4433195";
import {
  subscribeLiveChat,
  subscribeReactions,
} from "./diamond-live-engagement-subscriptions.js?v=1";
import { checkAuth } from "./auth.js?v=4433199";
import { isViewerChatEnabled } from "./live-game-chat.js?v=4";
import {
  formatDiamondInning,
  normalizeDiamondPublicGame,
  normalizeDiamondViewerMode,
  reconcileDiamondEventWindow,
  reconcileDiamondPagination,
} from "./diamond-live-view-model.js?v=2";
import { normalizeYouTubeReplayUrl } from "./game-replay-video.js?v=3";

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_INTERVAL_MS = 60_000;
const CHAT_THROTTLE_MS = 1500;
const REACTION_THROTTLE_MS = 1000;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERACTION_LIFECYCLES = new Set([
  "configured",
  "ready",
  "scheduled",
  "active",
  "suspended",
  "live",
  "in_progress",
  "in-progress",
  "final",
  "correction",
  "completed",
  "cancelled",
  "canceled",
  "deleted",
]);
const state = {
  teamId: "",
  gameId: "",
  game: null,
  events: [],
  nextCursor: null,
  complete: false,
  sourceRevision: 0,
  projectionToken: "",
  instanceId: "",
  replay: false,
  overlay: false,
  clipStartMs: null,
  clipEndMs: null,
  pollTimer: null,
  pollDelayMs: POLL_INTERVAL_MS,
  user: null,
  lastChatSentAt: 0,
  lastReactionSentAt: 0,
  pendingChatRequest: null,
  pendingReactionRequests: new Map(),
  engagementsInitialized: false,
  authInitialized: false,
  engagementError: "",
  engagementActionMessage: "",
  interactionLifecycleValid: false,
  unsubscribers: [],
};

const elements = {
  loading: document.querySelector("[data-diamond-loading]"),
  error: document.querySelector("[data-diamond-error]"),
  content: document.querySelector("[data-diamond-content]"),
  status: document.querySelector("[data-diamond-status]"),
  homeName: document.querySelector("[data-diamond-home-name]"),
  awayName: document.querySelector("[data-diamond-away-name]"),
  homeScore: document.querySelector("[data-diamond-home-score]"),
  awayScore: document.querySelector("[data-diamond-away-score]"),
  inning: document.querySelector("[data-diamond-inning]"),
  count: document.querySelector("[data-diamond-count]"),
  outs: document.querySelector("[data-diamond-outs]"),
  batter: document.querySelector("[data-diamond-batter]"),
  pitcher: document.querySelector("[data-diamond-pitcher]"),
  firstBase: document.querySelector('[data-diamond-base="first"]'),
  secondBase: document.querySelector('[data-diamond-base="second"]'),
  thirdBase: document.querySelector('[data-diamond-base="third"]'),
  warnings: document.querySelector("[data-diamond-warnings]"),
  plays: document.querySelector("[data-diamond-plays]"),
  empty: document.querySelector("[data-diamond-empty]"),
  loadMore: document.querySelector("[data-diamond-load-more]"),
  classicLink: document.querySelector("[data-diamond-classic-link]"),
  modeLabel: document.querySelector("[data-diamond-mode-label]"),
  media: document.querySelector("[data-diamond-media]"),
  mediaTitle: document.querySelector("[data-diamond-media-title]"),
  mediaFrame: document.querySelector("[data-diamond-media-frame]"),
  mediaFallback: document.querySelector("[data-diamond-media-fallback]"),
  mediaLink: document.querySelector("[data-diamond-media-link]"),
  chat: document.querySelector("[data-diamond-chat]"),
  chatEmpty: document.querySelector("[data-diamond-chat-empty]"),
  chatForm: document.querySelector("[data-diamond-chat-form]"),
  chatInput: document.querySelector("[data-diamond-chat-input]"),
  chatSubmit: document.querySelector("[data-diamond-chat-submit]"),
  signIn: document.querySelector("[data-diamond-sign-in]"),
  engagementStatus: document.querySelector("[data-diamond-engagement-status]"),
  reactions: document.querySelector("[data-diamond-reactions]"),
  reactionOverlay: document.querySelector("[data-diamond-reaction-overlay]"),
};

function parseContext() {
  const params = new URLSearchParams(window.location.search);
  state.teamId = (params.get("teamId") || "").trim();
  state.gameId = (params.get("gameId") || "").trim();
  if (!state.teamId || !state.gameId)
    throw new Error("This game link is incomplete.");
  const mode = normalizeDiamondViewerMode({
    replay: params.get("replay"),
    overlay: params.get("overlay"),
    clipStart: params.get("clipStart"),
    clipEnd: params.get("clipEnd"),
  });
  Object.assign(state, mode);
  document.body.dataset.viewMode = state.overlay
    ? "overlay"
    : state.replay
      ? "replay"
      : "live";
  elements.modeLabel.textContent = state.overlay
    ? state.replay
      ? "Replay overlay"
      : "Live overlay"
    : state.replay
      ? "Game replay"
      : "Live scorebook";
  document.title = `${elements.modeLabel.textContent} — ALL PLAYS Diamond`;
  const classicParams = new URLSearchParams(params);
  classicParams.set("classic", "1");
  classicParams.delete("overlay");
  elements.classicLink.href = `/live-game.html?${classicParams.toString()}`;
  const returnPath = `${window.location.pathname}${window.location.search}`;
  elements.signIn.href = `/app/#/auth?next=${encodeURIComponent(returnPath)}`;
}

function renderMedia() {
  const media = state.game?.media;
  if (!media) {
    elements.media.hidden = true;
    elements.mediaFrame.hidden = true;
    elements.mediaFrame.removeAttribute("src");
    return;
  }

  const youtube = normalizeYouTubeReplayUrl(media.publicUrl);
  const isClip = state.clipStartMs !== null && state.clipEndMs !== null;
  elements.media.hidden = false;
  elements.mediaTitle.textContent = isClip
    ? "Game clip"
    : media.mode === "replay"
      ? "Replay video"
      : "Live video";
  elements.mediaLink.href = media.publicUrl;
  elements.mediaLink.textContent = youtube
    ? "Open on YouTube"
    : "Open video in a new tab";

  if (!youtube) {
    elements.mediaFrame.hidden = true;
    elements.mediaFrame.removeAttribute("src");
    elements.mediaFallback.hidden = false;
    elements.mediaFallback.textContent =
      "This video provider opens in a separate tab.";
    return;
  }

  const embedUrl = new URL(youtube.embedUrl);
  embedUrl.searchParams.set("playsinline", "1");
  embedUrl.searchParams.set("rel", "0");
  if (state.clipStartMs !== null && state.clipEndMs !== null) {
    embedUrl.searchParams.set(
      "start",
      String(Math.floor(state.clipStartMs / 1000)),
    );
    embedUrl.searchParams.set("end", String(Math.ceil(state.clipEndMs / 1000)));
  }
  elements.mediaFrame.src = embedUrl.toString();
  elements.mediaFrame.title = elements.mediaTitle.textContent;
  elements.mediaFrame.hidden = false;
  elements.mediaFallback.hidden = true;
}

function setConnection(message, tone = "neutral") {
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
}

function renderBases(publicState) {
  [
    ["first", elements.firstBase],
    ["second", elements.secondBase],
    ["third", elements.thirdBase],
  ].forEach(([base, element]) =>
    element.classList.toggle("is-occupied", publicState.bases[base]),
  );
}

function renderWarnings(warnings) {
  elements.warnings.replaceChildren();
  warnings.forEach((warning) => {
    const item = document.createElement("li");
    item.textContent = warning;
    elements.warnings.append(item);
  });
  elements.warnings.hidden = warnings.length === 0;
}

function renderPlays() {
  elements.plays.replaceChildren();
  state.events.forEach((event) => {
    const item = document.createElement("li");
    item.className = `diamond-play${event.isScoringPlay ? " is-scoring" : ""}${event.isCorrection ? " is-correction" : ""}`;

    const marker = document.createElement("span");
    marker.className = "diamond-play__marker";
    marker.textContent = `${event.half === "bottom" ? "B" : "T"}${event.inning}`;

    const body = document.createElement("div");
    const description = document.createElement("strong");
    description.textContent = event.description;
    body.append(description);
    if (event.score) {
      const score = document.createElement("span");
      score.textContent = `Score ${event.score.away}–${event.score.home}`;
      body.append(score);
    }

    item.append(marker, body);
    elements.plays.append(item);
  });
  elements.empty.hidden = state.events.length > 0;
  elements.loadMore.hidden = state.complete || !state.nextCursor;
}

function render() {
  const game = state.game;
  const publicState = game.state;
  const isCancelled = ["cancelled", "canceled"].includes(publicState.status);
  elements.homeName.textContent = game.teamName;
  elements.awayName.textContent = game.opponent;
  elements.homeScore.textContent = String(publicState.homeScore);
  elements.awayScore.textContent = String(publicState.awayScore);
  elements.inning.textContent = isCancelled
    ? "Cancelled"
    : publicState.isFinal
      ? "Final"
      : formatDiamondInning(publicState);
  elements.count.textContent = `${publicState.balls}–${publicState.strikes}`;
  elements.outs.textContent = `${publicState.outs} out${publicState.outs === 1 ? "" : "s"}`;
  elements.batter.textContent = publicState.batterName || "—";
  elements.pitcher.textContent = publicState.pitcherName || "—";
  elements.content.dataset.completeness = publicState.completeness;
  renderBases(publicState);
  renderWarnings(game.warnings);
  renderPlays();
  renderMedia();
  elements.loading.hidden = true;
  elements.error.hidden = true;
  elements.content.hidden = false;
  renderEngagementAvailability();
}

function setEngagementStatus(message) {
  elements.engagementStatus.textContent = message;
}

function setEngagementActionMessage(message) {
  state.engagementActionMessage = message;
  setEngagementStatus(message);
}

function isCanonicalInteractionLifecycle(value) {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value === value.toLowerCase() &&
    INTERACTION_LIFECYCLES.has(value)
  );
}

function toClassicInteractionLifecycle(game) {
  const lifecycle = String(game?.state?.status || "").toLowerCase();
  const status =
    {
      configured: "scheduled",
      ready: "scheduled",
      scheduled: "scheduled",
      active: "live",
      suspended: "live",
      live: "live",
      in_progress: "in_progress",
      "in-progress": "in-progress",
      final: "final",
      correction: "final",
      completed: "completed",
      cancelled: "cancelled",
      canceled: "canceled",
      deleted: "deleted",
    }[lifecycle] || "invalid";
  return {
    type: "game",
    date: game?.startsAt || null,
    status,
    liveStatus: status,
    isCancelled: lifecycle === "cancelled" || lifecycle === "canceled",
  };
}

function isEngagementWindowOpen() {
  if (
    !state.game ||
    !state.interactionLifecycleValid ||
    state.replay ||
    state.overlay
  )
    return false;
  return isViewerChatEnabled(toClassicInteractionLifecycle(state.game));
}

function hasAuthenticatedViewer() {
  return Boolean(
    state.user && typeof state.user.uid === "string" && state.user.uid.trim(),
  );
}

function canWriteEngagement() {
  return (
    isEngagementWindowOpen() &&
    hasAuthenticatedViewer() &&
    UUID_V4_PATTERN.test(state.instanceId)
  );
}

function engagementLockMessage() {
  if (state.engagementError) return state.engagementError;
  if (state.overlay)
    return "Overlay mode is display-only. Open the game viewer to join chat.";
  if (state.replay)
    return "Replay mode is read-only. Messages from the game remain visible.";
  const lifecycle = String(state.game?.state?.status || "").toLowerCase();
  if (lifecycle === "cancelled" || lifecycle === "canceled")
    return "This game was cancelled. Earlier messages remain visible.";
  if (["final", "correction", "completed"].includes(lifecycle))
    return "This completed game is available as a read-only replay.";
  if (!state.game) return "Loading live chat availability…";
  if (!UUID_V4_PATTERN.test(state.instanceId))
    return "Live interaction security is unavailable. Refresh the game before posting.";
  if (!state.interactionLifecycleValid)
    return "Live chat is unavailable until the game status refreshes.";
  if (!isEngagementWindowOpen())
    return ["configured", "ready", "scheduled"].includes(lifecycle)
      ? "Live chat opens on game day."
      : "Live chat is unavailable for this game.";
  if (!hasAuthenticatedViewer())
    return "Sign in to post. Public game messages remain visible here.";
  if (state.engagementActionMessage) return state.engagementActionMessage;
  return "";
}

function renderEngagementAvailability() {
  const canWrite = canWriteEngagement();
  const engagementOpen = isEngagementWindowOpen();
  elements.chatInput.disabled = !canWrite;
  elements.chatSubmit.disabled = !canWrite;
  elements.signIn.hidden = !engagementOpen || hasAuthenticatedViewer();
  elements.chatInput.placeholder = canWrite
    ? "Send a message…"
    : state.overlay
      ? "Chat is unavailable in overlay mode"
      : state.replay
        ? "Chat is read-only in replay mode"
        : ["cancelled", "canceled"].includes(state.game?.state?.status)
          ? "Chat is read-only for a cancelled game"
          : state.game?.state?.isFinal
            ? "Chat is read-only after the game"
            : engagementOpen
              ? "Sign in to join live chat"
              : "Chat opens on game day";
  elements.reactions
    .querySelectorAll("[data-diamond-reaction]")
    .forEach((button) => {
      button.disabled = !canWrite;
    });
  setEngagementStatus(engagementLockMessage());
}

function renderChat(messages) {
  elements.chat
    .querySelectorAll(".diamond-chat-message")
    .forEach((element) => element.remove());
  const fragment = document.createDocumentFragment();
  [...messages].reverse().forEach((message) => {
    const row = document.createElement("article");
    row.className = "diamond-chat-message";
    const sender = document.createElement("strong");
    sender.textContent = String(message?.senderName || "Fan").slice(0, 80);
    const text = document.createElement("p");
    text.textContent = String(message?.text || "").slice(0, 2000);
    row.append(sender, text);
    fragment.append(row);
  });
  elements.chat.prepend(fragment);
  elements.chatEmpty.hidden = messages.length > 0;
  elements.chat.scrollTop = elements.chat.scrollHeight;
}

function reactionEmoji(type) {
  return (
    {
      fire: "🔥",
      clap: "👏",
      wow: "😮",
      heart: "❤️",
      hundred: "💯",
    }[String(type || "").toLowerCase()] || ""
  );
}

function showReaction(reaction) {
  const emoji = reactionEmoji(reaction?.type);
  if (!emoji) return;
  const bubble = document.createElement("span");
  bubble.className = "diamond-reaction-float";
  bubble.textContent = emoji;
  const stableOffset =
    [...String(reaction?.id || reaction?.type || "")].reduce(
      (sum, character) => sum + character.charCodeAt(0),
      0,
    ) % 70;
  bubble.style.left = `${String(10 + stableOffset)}%`;
  elements.reactionOverlay.append(bubble);
  window.setTimeout(() => bubble.remove(), 2000);
}

function reportEngagementError(message) {
  state.engagementError = message;
  renderEngagementAvailability();
}

function secureRequestId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    const value = cryptoApi.randomUUID();
    if (UUID_V4_PATTERN.test(value)) return value.toLowerCase();
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const value = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
    if (UUID_V4_PATTERN.test(value)) return value;
  }
  throw new Error("Secure request identity is unavailable.");
}

function engagementRequestBase(requestId) {
  return {
    schemaVersion: 1,
    requestId,
    teamId: state.teamId,
    gameId: state.gameId,
    expectedInstanceId: state.instanceId,
    viewerMode: "live",
  };
}

function getPendingChatRequest(text) {
  const pending = state.pendingChatRequest;
  if (
    pending?.text === text &&
    pending.request?.expectedInstanceId === state.instanceId
  ) {
    return pending;
  }
  const next = {
    text,
    request: { ...engagementRequestBase(secureRequestId()), text },
  };
  state.pendingChatRequest = next;
  return next;
}

function getPendingReactionRequest(type) {
  const pending = state.pendingReactionRequests.get(type);
  if (pending?.expectedInstanceId === state.instanceId) return pending;
  const next = { ...engagementRequestBase(secureRequestId()), type };
  state.pendingReactionRequests.set(type, next);
  return next;
}

async function submitDiamondEngagement(functionName, request, resultField) {
  const callable = httpsCallable(functions, functionName);
  const result = await callable(request);
  const response =
    result?.data && typeof result.data === "object" ? result.data : {};
  if (
    response.outcome !== "accepted" ||
    response.requestId !== request.requestId ||
    response.instanceId !== request.expectedInstanceId ||
    typeof response[resultField] !== "string" ||
    !response[resultField]
  ) {
    throw new Error("The server did not confirm the live interaction.");
  }
  return response;
}

function isEngagementRateLimit(error) {
  return String(error?.code || "").includes("resource-exhausted");
}

function initializeEngagementSubscriptions() {
  if (state.engagementsInitialized || !state.game || state.overlay) return;
  state.engagementsInitialized = true;
  try {
    const unsubscribe = subscribeLiveChat(
      state.teamId,
      state.gameId,
      { limit: 100, instanceId: state.instanceId },
      (messages) => renderChat(Array.isArray(messages) ? messages : []),
      () =>
        reportEngagementError(
          "Live chat is temporarily unavailable. The scorebook will keep refreshing.",
        ),
    );
    if (typeof unsubscribe === "function")
      state.unsubscribers.push(unsubscribe);
  } catch {
    reportEngagementError(
      "Live chat is temporarily unavailable. The scorebook will keep refreshing.",
    );
  }

  try {
    const unsubscribe = subscribeReactions(
      state.teamId,
      state.gameId,
      { instanceId: state.instanceId },
      showReaction,
      () =>
        reportEngagementError(
          "Live reactions are temporarily unavailable. The scorebook will keep refreshing.",
        ),
    );
    if (typeof unsubscribe === "function")
      state.unsubscribers.push(unsubscribe);
  } catch {
    reportEngagementError(
      "Live reactions are temporarily unavailable. The scorebook will keep refreshing.",
    );
  }
}

function initializeEngagementAuth() {
  if (state.authInitialized || !isEngagementWindowOpen()) return;
  state.authInitialized = true;
  try {
    const unsubscribe = checkAuth((user) => {
      state.user = user || null;
      renderEngagementAvailability();
    });
    if (typeof unsubscribe === "function")
      state.unsubscribers.push(unsubscribe);
  } catch {
    state.authInitialized = false;
    reportEngagementError(
      "Sign-in status is temporarily unavailable. Public game messages remain visible.",
    );
  }
}

elements.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!canWriteEngagement()) return;
  const message = elements.chatInput.value.replace(/\s+/g, " ").trim();
  if (!message) return;
  if (Date.now() - state.lastChatSentAt < CHAT_THROTTLE_MS) {
    setEngagementActionMessage(
      "Please wait a moment before sending another message.",
    );
    return;
  }
  state.lastChatSentAt = Date.now();
  elements.chatSubmit.disabled = true;
  let pending;
  try {
    pending = getPendingChatRequest(message.slice(0, 2000));
    await submitDiamondEngagement(
      "postDiamondLiveChat",
      pending.request,
      "messageId",
    );
    if (
      state.pendingChatRequest?.request.requestId === pending.request.requestId
    )
      state.pendingChatRequest = null;
    elements.chatInput.value = "";
    setEngagementActionMessage("");
  } catch (error) {
    setEngagementActionMessage(
      isEngagementRateLimit(error)
        ? "Please wait a moment before sending another message."
        : "Message not confirmed. Check your connection and retry without changing it.",
    );
  } finally {
    renderEngagementAvailability();
  }
});

elements.reactions.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-diamond-reaction]");
  if (!button || !canWriteEngagement()) return;
  const type = button.dataset.diamondReaction;
  if (!reactionEmoji(type)) return;
  if (Date.now() - state.lastReactionSentAt < REACTION_THROTTLE_MS) {
    setEngagementActionMessage(
      "Please wait a moment before sending another reaction.",
    );
    return;
  }
  state.lastReactionSentAt = Date.now();
  button.disabled = true;
  try {
    const request = getPendingReactionRequest(type);
    await submitDiamondEngagement(
      "postDiamondLiveReaction",
      request,
      "reactionId",
    );
    if (
      state.pendingReactionRequests.get(type)?.requestId === request.requestId
    )
      state.pendingReactionRequests.delete(type);
    setEngagementActionMessage("");
  } catch (error) {
    setEngagementActionMessage(
      isEngagementRateLimit(error)
        ? "Please wait a moment before sending another reaction."
        : "Reaction not confirmed. Check your connection and try again.",
    );
  } finally {
    window.setTimeout(renderEngagementAvailability, REACTION_THROTTLE_MS);
  }
});

function describeError(error) {
  const code = String(error?.code || "");
  if (code.includes("not-found")) return "This Diamond game is not available.";
  if (code.includes("resource-exhausted"))
    return "Too many refreshes. Please wait a moment.";
  return "The detailed scorebook is temporarily unavailable. The classic scoreboard may still be available.";
}

function isRetryableError(error) {
  const code = String(error?.code || "");
  return (
    !code ||
    code.includes("unavailable") ||
    code.includes("deadline-exceeded") ||
    code.includes("internal") ||
    code.includes("resource-exhausted")
  );
}

async function loadGame({ cursor = null, append = false, quiet = false } = {}) {
  const requestedSourceRevision = state.sourceRevision;
  const requestedProjectionToken = state.projectionToken;
  if (!quiet) setConnection("Updating…");
  try {
    const callable = httpsCallable(functions, "getPublicDiamondGame");
    const result = await callable({
      teamId: state.teamId,
      gameId: state.gameId,
      cursor,
      limit: 50,
    });
    const payload =
      result?.data && typeof result.data === "object" ? result.data : {};
    const responseInstanceId =
      typeof payload.instanceId === "string" &&
      payload.instanceId === payload.instanceId.toLowerCase() &&
      UUID_V4_PATTERN.test(payload.instanceId)
        ? payload.instanceId
        : "";
    if (!responseInstanceId) {
      throw Object.assign(new Error("Diamond generation is unavailable."), {
        code: "unavailable",
      });
    }
    if (state.instanceId && state.instanceId !== responseInstanceId) {
      state.pendingChatRequest = null;
      state.pendingReactionRequests.clear();
      throw Object.assign(new Error("Diamond generation changed."), {
        code: "failed-precondition",
      });
    }
    const interactionLifecycleValid = isCanonicalInteractionLifecycle(
      payload?.game?.state?.status,
    );
    const game = normalizeDiamondPublicGame(payload.game);
    if (game.trackingEngine !== "diamond-v2")
      throw Object.assign(new Error("Not a Diamond game."), {
        code: "not-found",
      });
    const responseRevision = Number.isSafeInteger(payload.sourceRevision)
      ? payload.sourceRevision
      : game.state.revision;
    const responseProjectionToken =
      typeof payload.projectionToken === "string"
        ? payload.projectionToken.slice(0, 256)
        : "";
    if (responseRevision < state.sourceRevision) {
      if (!state.game?.state?.isFinal) schedulePoll();
      return;
    }
    if (
      append &&
      requestedSourceRevision > 0 &&
      (responseRevision !== requestedSourceRevision ||
        (requestedProjectionToken &&
          responseProjectionToken &&
          responseProjectionToken !== requestedProjectionToken))
    ) {
      setConnection("Scorebook changed · refreshing replay", "warning");
      void loadGame({ quiet: true });
      return;
    }
    const reconciled = reconcileDiamondEventWindow({
      currentEvents: state.events,
      incomingEvents: payload.events,
      previousSourceRevision: state.sourceRevision,
      sourceRevision: responseRevision,
      previousProjectionToken: state.projectionToken,
      projectionToken: responseProjectionToken,
      append,
    });
    const pagination = reconcileDiamondPagination({
      previousSourceRevision: state.sourceRevision,
      sourceRevision: responseRevision,
      previousProjectionToken: state.projectionToken,
      projectionToken: responseProjectionToken,
      currentCursor: state.nextCursor,
      currentComplete: state.complete,
      nextCursor: payload.nextCursor,
      complete: payload.complete,
      append,
      hasLoadedGame: Boolean(state.game),
    });
    state.game = game;
    state.instanceId = responseInstanceId;
    state.interactionLifecycleValid = interactionLifecycleValid;
    state.events = reconciled.events;
    state.sourceRevision = reconciled.sourceRevision;
    state.projectionToken = reconciled.projectionToken;
    state.nextCursor = pagination.nextCursor;
    state.complete = pagination.complete;
    state.pollDelayMs = POLL_INTERVAL_MS;
    render();
    initializeEngagementSubscriptions();
    initializeEngagementAuth();
    const isCancelled = ["cancelled", "canceled"].includes(game.state.status);
    setConnection(
      state.replay
        ? "Revision-pinned replay"
        : isCancelled
          ? "Game cancelled"
          : game.state.isFinal
            ? "Final scorebook"
            : "Live · automatically refreshing",
      "success",
    );
    if (!game.state.isFinal && !state.replay) schedulePoll();
  } catch (error) {
    setConnection("Connection interrupted", "warning");
    if (!state.game) {
      elements.loading.hidden = true;
      elements.content.hidden = true;
      elements.error.textContent = describeError(error);
      elements.error.hidden = false;
    }
    if (!state.replay && isRetryableError(error))
      schedulePoll({ failed: true });
  }
}

function schedulePoll({ failed = false } = {}) {
  window.clearTimeout(state.pollTimer);
  if (state.replay) return;
  if (failed) {
    state.pollDelayMs = Math.min(
      MAX_POLL_INTERVAL_MS,
      Math.max(POLL_INTERVAL_MS, state.pollDelayMs * 2),
    );
  } else {
    state.pollDelayMs = POLL_INTERVAL_MS;
  }
  state.pollTimer = window.setTimeout(
    () => loadGame({ quiet: true }),
    state.pollDelayMs,
  );
}

elements.loadMore.addEventListener("click", () => {
  if (state.nextCursor)
    void loadGame({ cursor: state.nextCursor, append: true });
});

function cleanupSubscriptions() {
  window.clearTimeout(state.pollTimer);
  state.unsubscribers.forEach((unsubscribe) => {
    if (typeof unsubscribe === "function") unsubscribe();
  });
  state.unsubscribers = [];
}

window.addEventListener("beforeunload", cleanupSubscriptions);
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) cleanupSubscriptions();
});

try {
  parseContext();
  void loadGame();
} catch (error) {
  elements.loading.hidden = true;
  elements.error.textContent = describeError(error);
  elements.error.hidden = false;
}
