export function getReplayElapsedMs(nowMs, replayStartTimeMs, replaySpeed) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(replayStartTimeMs) || !Number.isFinite(replaySpeed) || replaySpeed <= 0) {
    return 0;
  }
  return Math.max(0, (nowMs - replayStartTimeMs) * replaySpeed);
}

export function rebaseReplayStartTimeMs(nowMs, currentElapsedMs, nextReplaySpeed) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(currentElapsedMs) || !Number.isFinite(nextReplaySpeed) || nextReplaySpeed <= 0) {
    return nowMs;
  }
  return nowMs - (Math.max(0, currentElapsedMs) / nextReplaySpeed);
}

export function getReplayStartTimeAfterSpeedChange(nowMs, replayStartTimeMs, replaySpeed, nextReplaySpeed, gameClockMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(nextReplaySpeed) || nextReplaySpeed <= 0) {
    return nowMs;
  }

  if (Number.isFinite(replayStartTimeMs) && Number.isFinite(replaySpeed) && replaySpeed > 0) {
    const elapsedMs = getReplayElapsedMs(nowMs, replayStartTimeMs, replaySpeed);
    return rebaseReplayStartTimeMs(nowMs, elapsedMs, nextReplaySpeed);
  }

  if (Number.isFinite(gameClockMs)) {
    return nowMs - (Math.max(0, gameClockMs) / nextReplaySpeed);
  }

  return nowMs;
}

export function getReplayTimestampMs(ts) {
  if (!ts) return null;
  if (typeof ts === 'number') return ts;
  if (typeof ts?.toMillis === 'function') return ts.toMillis();
  return null;
}

export function getReplayStartAt({ replayEvents = [], replayChat = [], replayReactions = [], fallbackNow = Date.now() } = {}) {
  const timestamps = [];
  replayEvents.forEach((event) => {
    const value = getReplayTimestampMs(event?.createdAt);
    if (Number.isFinite(value)) timestamps.push(value);
  });
  replayChat.forEach((message) => {
    const value = getReplayTimestampMs(message?.createdAt);
    if (Number.isFinite(value)) timestamps.push(value);
  });
  replayReactions.forEach((reaction) => {
    const value = getReplayTimestampMs(reaction?.createdAt);
    if (Number.isFinite(value)) timestamps.push(value);
  });
  return timestamps.length ? Math.min(...timestamps) : fallbackNow;
}

export function buildReplaySessionState({
  teamId,
  gameId,
  game = {},
  defaultPeriod = 'Q1',
  replayEvents = [],
  replayChat = [],
  replayReactions = [],
  fallbackNow = Date.now()
} = {}) {
  const sortedEvents = [...(replayEvents || [])].sort((a, b) => (a?.gameClockMs || 0) - (b?.gameClockMs || 0));
  const sortedChat = [...(replayChat || [])].sort((a, b) => (getReplayTimestampMs(a?.createdAt) || 0) - (getReplayTimestampMs(b?.createdAt) || 0));
  const sortedReactions = [...(replayReactions || [])].sort((a, b) => (getReplayTimestampMs(a?.createdAt) || 0) - (getReplayTimestampMs(b?.createdAt) || 0));
  const hasReplayEvents = sortedEvents.length > 0;
  const homeScore = game?.homeScore ?? 0;
  const awayScore = game?.awayScore ?? 0;

  return {
    hasReplayEvents,
    showReplayControls: true,
    hideReactionsBar: true,
    hideEndedOverlay: true,
    disableChatComposer: true,
    replayGameHref: `game.html#teamId=${teamId}&gameId=${gameId}`,
    emptyStateMessage: hasReplayEvents ? '' : 'No play-by-play data available for this game.',
    finalScoreText: `${homeScore} - ${awayScore}`,
    scoreboard: {
      homeScore: hasReplayEvents ? 0 : homeScore,
      awayScore: hasReplayEvents ? 0 : awayScore,
      period: hasReplayEvents ? defaultPeriod : (game?.period || defaultPeriod),
      gameClockMs: 0
    },
    replayEvents: sortedEvents,
    replayChat: sortedChat,
    replayReactions: sortedReactions,
    replayStartAt: getReplayStartAt({
      replayEvents: sortedEvents,
      replayChat: sortedChat,
      replayReactions: sortedReactions,
      fallbackNow
    })
  };
}

export function collectReplayEventWindow({ replayEvents = [], replayIndex = 0, elapsedMs = 0 } = {}) {
  const events = [];
  let nextReplayIndex = replayIndex;

  while (
    nextReplayIndex < replayEvents.length &&
    (replayEvents[nextReplayIndex]?.gameClockMs || 0) <= elapsedMs
  ) {
    events.push(replayEvents[nextReplayIndex]);
    nextReplayIndex += 1;
  }

  return { events, nextReplayIndex };
}

export function collectReplayStreamWindow(sessionOrOptions = {}, elapsedMs = 0) {
  const replayStartAt = Number.isFinite(sessionOrOptions.replayStartAt) ? sessionOrOptions.replayStartAt : Date.now();
  const replayEvents = Array.isArray(sessionOrOptions.replayEvents) ? sessionOrOptions.replayEvents : [];
  const replayChat = Array.isArray(sessionOrOptions.replayChat) ? sessionOrOptions.replayChat : [];
  const replayReactions = Array.isArray(sessionOrOptions.replayReactions) ? sessionOrOptions.replayReactions : [];
  const replayIndex = Number.isFinite(sessionOrOptions.replayIndex) ? sessionOrOptions.replayIndex : 0;
  const replayChatIndex = Number.isFinite(sessionOrOptions.replayChatIndex) ? sessionOrOptions.replayChatIndex : 0;
  const replayReactionIndex = Number.isFinite(sessionOrOptions.replayReactionIndex) ? sessionOrOptions.replayReactionIndex : 0;
  const replayTime = replayStartAt + Math.max(0, elapsedMs || 0);

  const { events, nextReplayIndex } = collectReplayEventWindow({
    replayEvents,
    replayIndex,
    elapsedMs
  });

  const chatMessages = [];
  let nextReplayChatIndex = replayChatIndex;
  while (nextReplayChatIndex < replayChat.length) {
    const message = replayChat[nextReplayChatIndex];
    const timestamp = getReplayTimestampMs(message?.createdAt);
    if (!timestamp || timestamp <= replayTime) {
      chatMessages.push(message);
      nextReplayChatIndex += 1;
      continue;
    }
    break;
  }

  const reactions = [];
  let nextReplayReactionIndex = replayReactionIndex;
  while (nextReplayReactionIndex < replayReactions.length) {
    const reaction = replayReactions[nextReplayReactionIndex];
    const timestamp = getReplayTimestampMs(reaction?.createdAt);
    if (!timestamp || timestamp <= replayTime) {
      reactions.push(reaction);
      nextReplayReactionIndex += 1;
      continue;
    }
    break;
  }

  return {
    events,
    chatMessages,
    reactions,
    nextReplayIndex,
    nextReplayChatIndex,
    nextReplayReactionIndex
  };
}
