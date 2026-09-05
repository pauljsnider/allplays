import { functions, httpsCallable } from "./firebase.js?v=4433195";
import {
  postLiveChatMessage,
  sendReaction,
  subscribeLiveChat,
  subscribeReactions,
} from "./db.js?v=4433195";
import { checkAuth } from "./auth.js?v=4433199";
import {
  formatDiamondInning,
  normalizeDiamondPublicGame,
  reconcileDiamondEventWindow,
  reconcileDiamondPagination,
} from "./diamond-live-view-model.js?v=1";

const POLL_INTERVAL_MS = 5000;
const state = {
  teamId: "",
  gameId: "",
  game: null,
  events: [],
  nextCursor: null,
  complete: false,
  sourceRevision: 0,
  projectionToken: "",
  pollTimer: null,
  user: null,
  lastChatSentAt: 0,
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
  const classicParams = new URLSearchParams(params);
  classicParams.set("classic", "1");
  elements.classicLink.href = `/live-game.html?${classicParams.toString()}`;
  const returnPath = `${window.location.pathname}${window.location.search}`;
  elements.signIn.href = `/app/#/auth?next=${encodeURIComponent(returnPath)}`;
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
  elements.homeName.textContent = game.teamName;
  elements.awayName.textContent = game.opponent;
  elements.homeScore.textContent = String(publicState.homeScore);
  elements.awayScore.textContent = String(publicState.awayScore);
  elements.inning.textContent = publicState.isFinal
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
  elements.loading.hidden = true;
  elements.error.hidden = true;
  elements.content.hidden = false;
  renderEngagementAvailability();
}

function setEngagementStatus(message) {
  elements.engagementStatus.textContent = message;
}

function renderEngagementAvailability() {
  const canWrite = Boolean(state.user) && state.game?.state?.isFinal !== true;
  elements.chatInput.disabled = !canWrite;
  elements.chatSubmit.disabled = !canWrite;
  elements.signIn.hidden = Boolean(state.user);
  elements.chatInput.placeholder = canWrite
    ? "Send a message…"
    : state.game?.state?.isFinal
      ? "Chat is read-only after the final out"
      : "Sign in to join live chat";
  elements.reactions
    .querySelectorAll("[data-diamond-reaction]")
    .forEach((button) => {
      button.disabled = !canWrite;
    });
  if (!state.user && !state.game?.state?.isFinal) {
    setEngagementStatus(
      "Sign in to post. Public game messages remain visible here.",
    );
  } else if (state.game?.state?.isFinal) {
    setEngagementStatus(
      "This completed game is available as a read-only replay.",
    );
  } else {
    setEngagementStatus("");
  }
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

function initializeEngagements() {
  try {
    state.unsubscribers.push(
      subscribeLiveChat(
        state.teamId,
        state.gameId,
        { limit: 100 },
        (messages) => renderChat(Array.isArray(messages) ? messages : []),
        () =>
          setEngagementStatus(
            "Live chat is temporarily unavailable. The scorebook will keep refreshing.",
          ),
      ),
    );
    state.unsubscribers.push(
      subscribeReactions(state.teamId, state.gameId, showReaction, () =>
        setEngagementStatus(
          "Live reactions are temporarily unavailable. The scorebook will keep refreshing.",
        ),
      ),
    );
  } catch {
    setEngagementStatus(
      "Live chat is temporarily unavailable. The scorebook will keep refreshing.",
    );
  }

  const unsubscribeAuth = checkAuth((user) => {
    state.user = user || null;
    renderEngagementAvailability();
  });
  if (typeof unsubscribeAuth === "function")
    state.unsubscribers.push(unsubscribeAuth);
}

elements.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user || state.game?.state?.isFinal) return;
  const message = elements.chatInput.value.replace(/\s+/g, " ").trim();
  if (!message) return;
  if (Date.now() - state.lastChatSentAt < 1500) {
    setEngagementStatus("Please wait a moment before sending another message.");
    return;
  }
  state.lastChatSentAt = Date.now();
  elements.chatSubmit.disabled = true;
  try {
    await postLiveChatMessage(state.teamId, state.gameId, {
      text: message.slice(0, 2000),
      senderId: state.user.uid,
      senderName: String(state.user.displayName || "Fan").slice(0, 80),
      isAnonymous: false,
    });
    elements.chatInput.value = "";
    setEngagementStatus("");
  } catch {
    setEngagementStatus(
      "Message not sent. Check your connection and try again.",
    );
  } finally {
    renderEngagementAvailability();
  }
});

elements.reactions.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-diamond-reaction]");
  if (!button || !state.user || state.game?.state?.isFinal) return;
  const type = button.dataset.diamondReaction;
  if (!reactionEmoji(type)) return;
  button.disabled = true;
  try {
    await sendReaction(state.teamId, state.gameId, {
      type,
      senderId: state.user.uid,
    });
  } catch {
    setEngagementStatus(
      "Reaction not sent. Check your connection and try again.",
    );
  } finally {
    window.setTimeout(renderEngagementAvailability, 1000);
  }
});

function describeError(error) {
  const code = String(error?.code || "");
  if (code.includes("not-found")) return "This Diamond game is not available.";
  if (code.includes("resource-exhausted"))
    return "Too many refreshes. Please wait a moment.";
  return "The detailed scorebook is temporarily unavailable. The classic scoreboard may still be available.";
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
    state.events = reconciled.events;
    state.sourceRevision = reconciled.sourceRevision;
    state.projectionToken = reconciled.projectionToken;
    state.nextCursor = pagination.nextCursor;
    state.complete = pagination.complete;
    render();
    setConnection(
      game.state.isFinal
        ? "Final scorebook"
        : "Live · automatically refreshing",
      "success",
    );
    if (!game.state.isFinal) schedulePoll();
  } catch (error) {
    setConnection("Connection interrupted", "warning");
    if (!state.game) {
      elements.loading.hidden = true;
      elements.content.hidden = true;
      elements.error.textContent = describeError(error);
      elements.error.hidden = false;
    }
  }
}

function schedulePoll() {
  window.clearTimeout(state.pollTimer);
  state.pollTimer = window.setTimeout(
    () => loadGame({ quiet: true }),
    POLL_INTERVAL_MS,
  );
}

elements.loadMore.addEventListener("click", () => {
  if (state.nextCursor)
    void loadGame({ cursor: state.nextCursor, append: true });
});

window.addEventListener("beforeunload", () => {
  window.clearTimeout(state.pollTimer);
  state.unsubscribers.forEach((unsubscribe) => {
    if (typeof unsubscribe === "function") unsubscribe();
  });
});

try {
  parseContext();
  initializeEngagements();
  void loadGame();
} catch (error) {
  elements.loading.hidden = true;
  elements.error.textContent = describeError(error);
  elements.error.hidden = false;
}
