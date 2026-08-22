import {
    applyOverlayEvents,
    applyOverlayGame,
    createOverlayDemoFixture,
    createOverlayState,
    formatOverlayClock,
    getControllableReplayEmbedUrl,
    getOverlayLineup,
    getOverlayReplayDurationMs,
    normalizeOverlayEvent,
    replaceOverlayChat
} from './live-game-overlay-model.js?v=3';
import {
    buildReplaySessionState,
    collectReplayEventWindow,
    collectReplayStreamWindow,
    getReplayElapsedMs,
    getReplayStartTimeAfterSpeedChange,
    rebaseReplayStartTimeMs
} from './live-game-replay.js?v=3';
import { getDefaultLivePeriod } from './live-sport-config.js?v=2';

const elements = {
    body: document.body,
    iframe: document.querySelector('#overlay-video'),
    recordedVideo: document.querySelector('#overlay-recorded-video'),
    videoFallback: document.querySelector('#video-fallback'),
    videoFallbackCopy: document.querySelector('#video-fallback-copy'),
    openStream: document.querySelector('#open-stream'),
    liveStatus: document.querySelector('#live-status'),
    viewerCount: document.querySelector('#viewer-count'),
    homeName: document.querySelector('#home-team-name'),
    awayName: document.querySelector('#away-team-name'),
    homeScore: document.querySelector('#home-score'),
    awayScore: document.querySelector('#away-score'),
    period: document.querySelector('#period'),
    gameClock: document.querySelector('#game-clock'),
    eventList: document.querySelector('#event-list'),
    heroEvent: document.querySelector('#hero-event'),
    heroEventLabel: document.querySelector('#hero-event-label'),
    heroEventDescription: document.querySelector('#hero-event-description'),
    heroEventTime: document.querySelector('#hero-event-time'),
    playsPanel: document.querySelector('#plays-panel'),
    insightsPanel: document.querySelector('#insights-panel'),
    onFieldList: document.querySelector('#on-field-list'),
    benchList: document.querySelector('#bench-list'),
    leaderList: document.querySelector('#leader-list'),
    chatList: document.querySelector('#chat-list'),
    panelToggles: [...document.querySelectorAll('[data-panel]')],
    insightTabs: [...document.querySelectorAll('[role="tab"][aria-controls]')],
    insightViews: [...document.querySelectorAll('[role="tabpanel"]')],
    focusToggle: document.querySelector('#focus-toggle'),
    demoLab: document.querySelector('#demo-lab'),
    demoLabToggle: document.querySelector('#demo-lab-toggle'),
    demoLabClose: document.querySelector('#demo-lab-close'),
    demoActions: [...document.querySelectorAll('[data-action]')],
    replayControls: document.querySelector('#replay-controls'),
    replayRestart: document.querySelector('#replay-restart'),
    replayPlay: document.querySelector('#replay-play'),
    replayProgress: document.querySelector('#replay-progress'),
    replayCurrent: document.querySelector('#replay-current'),
    replayDuration: document.querySelector('#replay-duration'),
    replaySpeeds: [...document.querySelectorAll('[data-replay-speed]')],
    connectionMessage: document.querySelector('#connection-message'),
    reactionsOverlay: document.querySelector('#reactions-overlay'),
    screenReaderUpdate: document.querySelector('#screen-reader-update')
};

const uiState = {
    game: null,
    isDemo: false,
    clockRunning: false,
    clockTimer: null,
    demoEventCounter: 0,
    previousHomeScore: null,
    previousAwayScore: null,
    latestRenderedEventId: null,
    activeMobilePanel: null,
    desktopPanels: { plays: true, insights: true },
    activeInsight: 'lineup',
    liveEventsFirstLoad: true,
    reactionIds: new Set(),
    isReplay: false,
    replaySession: null,
    replayPlaying: false,
    replaySpeed: 1,
    replayStartTime: null,
    replayElapsedMs: 0,
    replayDurationMs: 0,
    replayFrame: null,
    videoMode: 'none',
    videoOrigin: '',
    videoDurationMs: 0,
    unsubscribers: []
};

function createTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
}

function getQueryParams() {
    return Object.fromEntries(new URLSearchParams(window.location.search).entries());
}

function isMobileLayout() {
    return window.matchMedia('(max-width: 900px)').matches;
}

function getTimestampMs(value) {
    if (Number.isFinite(value)) return Number(value);
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value && typeof value.toDate === 'function') return value.toDate().getTime();
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function setConnectionMessage(message = '', tone = 'warning') {
    if (!elements.connectionMessage) return;
    elements.connectionMessage.textContent = message;
    elements.connectionMessage.dataset.tone = tone;
    elements.connectionMessage.hidden = !message;
}

function setStatus(status = '') {
    const normalized = String(status || '').trim().toLowerCase();
    const labels = {
        live: 'LIVE',
        completed: 'FINAL',
        final: 'FINAL',
        scheduled: 'UPCOMING',
        replay: 'REPLAY',
        loading: 'Loading'
    };
    elements.liveStatus.dataset.status = normalized || 'scheduled';
    elements.liveStatus.textContent = labels[normalized] || normalized.toUpperCase() || 'UPCOMING';
}

function flashScore(element) {
    if (!element) return;
    element.dataset.flash = 'false';
    void element.offsetWidth;
    element.dataset.flash = 'true';
    window.setTimeout(() => {
        element.dataset.flash = 'false';
    }, 560);
}

function renderScoreboard() {
    const state = uiState.game;
    if (!state) return;
    elements.homeName.textContent = state.homeName;
    elements.awayName.textContent = state.awayName;
    elements.homeScore.textContent = String(state.homeScore);
    elements.awayScore.textContent = String(state.awayScore);
    elements.period.textContent = state.period;
    elements.gameClock.textContent = formatOverlayClock(state.gameClockMs);
    elements.gameClock.dateTime = `PT${Math.floor(state.gameClockMs / 60000)}M${Math.floor((state.gameClockMs % 60000) / 1000)}S`;
    elements.viewerCount.textContent = `${state.viewerCount} watching`;
    setStatus(state.liveStatus);

    if (uiState.previousHomeScore !== null && uiState.previousHomeScore !== state.homeScore) flashScore(elements.homeScore);
    if (uiState.previousAwayScore !== null && uiState.previousAwayScore !== state.awayScore) flashScore(elements.awayScore);
    uiState.previousHomeScore = state.homeScore;
    uiState.previousAwayScore = state.awayScore;
}

function renderEventCard(event, isNew = false) {
    const item = document.createElement('li');
    item.className = 'event-card';
    item.dataset.eventId = event.id;
    item.dataset.tone = event.tone;
    item.dataset.new = String(isNew);

    const meta = document.createElement('div');
    meta.className = 'event-meta';
    meta.appendChild(createTextElement('span', '', `${event.period} · ${formatOverlayClock(event.gameClockMs)}`));
    if (event.label) meta.appendChild(createTextElement('span', 'event-label', event.label));
    item.appendChild(meta);
    item.appendChild(createTextElement('p', 'event-description', event.description));

    const playerLabel = [event.playerNumber ? `#${event.playerNumber}` : '', event.playerName || event.opponentPlayerName || '']
        .filter(Boolean)
        .join(' ');
    if (playerLabel) item.appendChild(createTextElement('p', 'event-player', playerLabel));
    return item;
}

function renderEvents() {
    const state = uiState.game;
    if (!state) return;
    const latestId = state.latestEvent?.id || null;
    const isNewLatest = Boolean(latestId && uiState.latestRenderedEventId && latestId !== uiState.latestRenderedEventId);
    elements.eventList.replaceChildren();
    if (!state.events.length) {
        const emptyCopy = uiState.isReplay
            ? 'Replay ready. Press play or scrub the timeline to revisit the game.'
            : 'Connected. Waiting for the first play…';
        elements.eventList.appendChild(createTextElement('li', 'empty-state', emptyCopy));
    } else {
        state.events.slice(0, 18).forEach((event, index) => {
            elements.eventList.appendChild(renderEventCard(event, isNewLatest && index === 0));
        });
    }

    const latest = state.latestEvent;
    if (latest) {
        elements.heroEvent.dataset.tone = latest.tone;
        elements.heroEventLabel.textContent = latest.label || 'Latest play';
        elements.heroEventDescription.textContent = latest.description;
        elements.heroEventTime.textContent = `${latest.period} · ${formatOverlayClock(latest.gameClockMs)}`;
        if (isNewLatest) {
            elements.screenReaderUpdate.textContent = `${latest.description}. Score ${state.homeScore} to ${state.awayScore}.`;
        }
    } else {
        elements.heroEvent.dataset.tone = 'system';
        elements.heroEventLabel.textContent = uiState.isReplay ? 'Replay ready' : 'Latest play';
        elements.heroEventDescription.textContent = uiState.isReplay
            ? 'Press play or move the timeline to revisit the game.'
            : 'Waiting for the first play…';
        elements.heroEventTime.textContent = '—';
    }
    uiState.latestRenderedEventId = latestId;
}

function getStatSummary(stats = {}) {
    const preferredKeys = ['goals', 'pts', 'points', 'assists', 'saves', 'shots', 'reb', 'ast', 'stl'];
    const entries = Object.entries(stats)
        .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
        .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
            const leftRank = preferredKeys.indexOf(leftKey.toLowerCase());
            const rightRank = preferredKeys.indexOf(rightKey.toLowerCase());
            if (leftRank !== rightRank) return (leftRank < 0 ? 99 : leftRank) - (rightRank < 0 ? 99 : rightRank);
            return Number(rightValue) - Number(leftValue);
        });
    if (!entries.length) return { label: 'Ready', value: '' };
    const [key, value] = entries[0];
    return { label: key.replaceAll('_', ' ').toUpperCase(), value: String(value) };
}

function renderPlayerRow(player) {
    const item = document.createElement('li');
    item.className = 'player-row';
    item.appendChild(createTextElement('span', 'player-number', player.number || player.name.charAt(0)));
    const identity = document.createElement('div');
    identity.appendChild(createTextElement('strong', '', player.name));
    identity.appendChild(createTextElement('small', '', player.position || 'Available'));
    item.appendChild(identity);
    const stat = getStatSummary(player.stats);
    const statBlock = document.createElement('span');
    statBlock.className = 'player-stat';
    statBlock.textContent = stat.value ? `${stat.value} ${stat.label}` : stat.label;
    item.appendChild(statBlock);
    return item;
}

function renderLineupList(container, players, emptyText) {
    container.replaceChildren();
    if (!players.length) {
        container.appendChild(createTextElement('li', 'empty-state', emptyText));
        return;
    }
    players.forEach((player) => container.appendChild(renderPlayerRow(player)));
}

function renderLineup() {
    const state = uiState.game;
    if (!state) return;
    renderLineupList(elements.onFieldList, getOverlayLineup(state, 'onCourt'), 'No on-field lineup has been posted yet.');
    renderLineupList(elements.benchList, getOverlayLineup(state, 'bench'), 'No bench lineup has been posted yet.');
}

function renderLeaders() {
    const state = uiState.game;
    if (!state) return;
    const leaders = state.players
        .map((player) => ({ ...player, stats: state.stats[player.id] || {} }))
        .map((player) => ({ player, total: Object.values(player.stats).reduce((sum, value) => sum + (Number(value) || 0), 0) }))
        .sort((left, right) => right.total - left.total || left.player.name.localeCompare(right.player.name))
        .slice(0, 6)
        .map(({ player }) => player);
    renderLineupList(elements.leaderList, leaders, 'Player leaders will appear as live stats arrive.');
}

function renderChat() {
    const state = uiState.game;
    if (!state) return;
    elements.chatList.replaceChildren();
    if (!state.chatMessages.length) {
        elements.chatList.appendChild(createTextElement(
            'li',
            'empty-state',
            uiState.isReplay ? 'Saved conversation will appear with the replay timeline.' : 'Live chat is quiet right now.'
        ));
        return;
    }
    state.chatMessages.slice(0, 24).forEach((message) => {
        const item = document.createElement('li');
        item.className = 'chat-row';
        item.dataset.ai = String(Boolean(message.ai));
        item.appendChild(createTextElement('span', 'chat-avatar', message.ai ? 'AP' : message.senderName.charAt(0).toUpperCase()));
        const content = document.createElement('div');
        content.appendChild(createTextElement('strong', '', message.senderName));
        content.appendChild(createTextElement('p', '', message.text));
        item.appendChild(content);
        elements.chatList.appendChild(item);
    });
}

function renderAll() {
    renderScoreboard();
    renderEvents();
    renderLineup();
    renderLeaders();
    renderChat();
}

function resetOverlayFromGame(game = {}, stateTools, message = 'Game reset. Waiting for plays…') {
    const liveLineup = game.liveLineup || {};
    const next = stateTools.applyResetEventState(uiState.game, {
        period: game.period || uiState.game.period,
        homeScore: Number.isFinite(game.homeScore) ? game.homeScore : 0,
        awayScore: Number.isFinite(game.awayScore) ? game.awayScore : 0,
        gameClockMs: Number.isFinite(game.liveClockMs) ? game.liveClockMs : Number(game.gameClockMs) || 0,
        sport: game.sport || uiState.game.sport,
        periods: Array.isArray(game.periods) ? game.periods : uiState.game.periods,
        onCourt: Array.isArray(liveLineup.onCourt) ? liveLineup.onCourt : [],
        bench: Array.isArray(liveLineup.bench) ? liveLineup.bench : []
    });
    Object.assign(uiState.game, next, { latestEvent: null });
    uiState.latestRenderedEventId = null;
    renderAll();
    const placeholder = elements.eventList.querySelector('.empty-state');
    if (placeholder) placeholder.textContent = message;
}

function processLiveEventSnapshot(events = [], stateTools, { preserveSeededOpponentGoalStats = false } = {}) {
    const visibleEvents = stateTools.collectVisibleLiveEventsSequentially(events, {
        seenIds: uiState.game.eventIds,
        resetBoundaryMs: uiState.game.lastResetAt
    });

    visibleEvents.forEach((rawEvent, index) => {
        const event = normalizeOverlayEvent(rawEvent, index);
        uiState.game.eventIds.add(event.id);

        if (event.type === 'reset') {
            const resetAt = getTimestampMs(event.createdAt) || Date.now();
            uiState.game.lastResetAt = Math.max(uiState.game.lastResetAt || 0, resetAt);
            const next = stateTools.applyResetEventState(uiState.game, event);
            Object.assign(uiState.game, next, { latestEvent: null });
            uiState.game.eventIds.add(event.id);
            uiState.latestRenderedEventId = null;
            return;
        }

        const previousEvents = [...uiState.game.events];
        const transition = stateTools.applyViewerEventToState(
            { ...uiState.game, events: [] },
            event,
            { preserveSeededOpponentGoalStats }
        );
        Object.assign(uiState.game, transition.state);
        uiState.game.events = previousEvents;

        if (transition.shouldRenderPlayByPlay) {
            uiState.game.events = [event, ...previousEvents]
                .sort((left, right) => right.createdAtMs - left.createdAtMs)
                .slice(0, 60);
            uiState.game.latestEvent = event;
        }
    });

    renderAll();
}

function getReactionEmoji(type) {
    const reactions = {
        fire: '🔥',
        clap: '👏',
        wow: '😲',
        heart: '❤️',
        hundred: '💯'
    };
    return reactions[String(type || '').toLowerCase()] || '🔥';
}

function showFloatingReaction(reaction = {}) {
    if (!elements.reactionsOverlay) return;
    const reactionId = String(reaction.id || '').trim();
    if (reactionId && uiState.reactionIds.has(reactionId)) return;
    if (reactionId) uiState.reactionIds.add(reactionId);

    const bubble = createTextElement('span', 'floating-reaction', getReactionEmoji(reaction.type || reaction.reaction));
    bubble.style.setProperty('--reaction-x', `${18 + Math.round(Math.random() * 64)}%`);
    bubble.addEventListener('animationend', () => bubble.remove(), { once: true });
    elements.reactionsOverlay.appendChild(bubble);
}

function createReplayBaseState() {
    const session = uiState.replaySession;
    const current = uiState.game;
    const hasReplayEvents = Boolean(session?.hasReplayEvents);
    const game = {
        ...current.game,
        homeScore: session?.scoreboard.homeScore ?? current.homeScore,
        awayScore: session?.scoreboard.awayScore ?? current.awayScore,
        period: session?.scoreboard.period || current.period,
        liveClockMs: 0,
        gameClockMs: 0,
        liveStatus: 'replay',
        status: 'replay'
    };
    if (hasReplayEvents) {
        game.liveLineup = { onCourt: [], bench: [] };
        game.liveStats = {};
        game.stats = {};
        game.opponentStats = {};
    }

    const next = createOverlayState({
        team: current.team,
        game,
        players: current.players
    });
    next.liveStatus = 'replay';
    return next;
}

function clearReplayReactions() {
    uiState.reactionIds.clear();
    elements.reactionsOverlay?.replaceChildren();
}

function setReplayControlState() {
    const duration = uiState.replayDurationMs;
    const elapsed = Math.min(duration, Math.max(0, uiState.replayElapsedMs));
    elements.replayCurrent.textContent = formatOverlayClock(elapsed);
    elements.replayDuration.textContent = formatOverlayClock(duration);
    elements.replayCurrent.dateTime = `PT${Math.floor(elapsed / 60000)}M${Math.floor((elapsed % 60000) / 1000)}S`;
    elements.replayDuration.dateTime = `PT${Math.floor(duration / 60000)}M${Math.floor((duration % 60000) / 1000)}S`;
    elements.replayProgress.value = duration > 0 ? String((elapsed / duration) * 100) : '0';
    elements.replayProgress.disabled = duration <= 0;
    elements.replayPlay.disabled = duration <= 0;
    elements.replayRestart.disabled = duration <= 0;
    elements.replayPlay.textContent = uiState.replayPlaying ? 'Pause' : (elapsed >= duration && duration > 0 ? 'Play again' : 'Play');
    elements.replayPlay.setAttribute('aria-label', uiState.replayPlaying ? 'Pause replay' : 'Play replay');
    elements.replaySpeeds.forEach((button) => {
        button.setAttribute('aria-pressed', String(Number(button.dataset.replaySpeed) === uiState.replaySpeed));
    });
}

function sendYouTubeCommand(command, args = []) {
    if (uiState.videoMode !== 'youtube' || !elements.iframe.contentWindow) return;
    elements.iframe.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func: command,
        args
    }), uiState.videoOrigin || 'https://www.youtube.com');
}

function syncReplayMedia({ seek = false, play = uiState.replayPlaying } = {}) {
    if (!uiState.isReplay) return;
    const seconds = Math.max(0, uiState.replayElapsedMs / 1000);

    if (uiState.videoMode === 'recorded') {
        if (seek && Number.isFinite(elements.recordedVideo.duration)) {
            elements.recordedVideo.currentTime = Math.min(seconds, elements.recordedVideo.duration);
        } else if (seek) {
            elements.recordedVideo.currentTime = seconds;
        }
        elements.recordedVideo.playbackRate = uiState.replaySpeed;
        if (play) elements.recordedVideo.play().catch(() => {});
        else elements.recordedVideo.pause();
        return;
    }

    if (uiState.videoMode === 'youtube') {
        if (seek) sendYouTubeCommand('seekTo', [seconds, true]);
        sendYouTubeCommand('setPlaybackRate', [uiState.replaySpeed]);
        sendYouTubeCommand(play ? 'playVideo' : 'pauseVideo');
    }
}

function applyReplayStreams(elapsedMs, { animateReactions = true } = {}) {
    const session = uiState.replaySession;
    const replayWindow = collectReplayStreamWindow({
        replayChat: session.replayChat,
        replayReactions: session.replayReactions,
        replayChatIndex: session.replayChatIndex,
        replayReactionIndex: session.replayReactionIndex,
        replayStartAt: session.replayStartAt
    }, elapsedMs);

    if (replayWindow.chatMessages.length) {
        replaceOverlayChat(uiState.game, [...uiState.game.chatMessages, ...replayWindow.chatMessages]);
        renderChat();
    }
    if (animateReactions) replayWindow.reactions.forEach(showFloatingReaction);
    session.replayChatIndex = replayWindow.nextReplayChatIndex;
    session.replayReactionIndex = replayWindow.nextReplayReactionIndex;
}

function resetReplayToElapsed(targetMs, stateTools, { animateReactions = false } = {}) {
    const duration = uiState.replayDurationMs;
    const elapsed = Math.min(duration, Math.max(0, Number(targetMs) || 0));
    uiState.game = createReplayBaseState();
    uiState.previousHomeScore = null;
    uiState.previousAwayScore = null;
    uiState.latestRenderedEventId = null;
    uiState.replaySession.replayIndex = 0;
    uiState.replaySession.replayChatIndex = 0;
    uiState.replaySession.replayReactionIndex = 0;
    clearReplayReactions();

    const eventWindow = collectReplayEventWindow({
        replayEvents: uiState.replaySession.replayEvents,
        replayIndex: 0,
        elapsedMs: elapsed
    });
    if (eventWindow.events.length) {
        processLiveEventSnapshot(eventWindow.events, stateTools);
    }
    uiState.replaySession.replayIndex = eventWindow.nextReplayIndex;
    applyReplayStreams(elapsed, { animateReactions });
    uiState.replayElapsedMs = elapsed;
    uiState.game.gameClockMs = elapsed;
    renderAll();
    setReplayControlState();
}

function advanceReplayToElapsed(elapsedMs, stateTools) {
    const elapsed = Math.min(uiState.replayDurationMs, Math.max(0, elapsedMs));
    const session = uiState.replaySession;
    const eventWindow = collectReplayEventWindow({
        replayEvents: session.replayEvents,
        replayIndex: session.replayIndex,
        elapsedMs: elapsed
    });
    if (eventWindow.events.length) processLiveEventSnapshot(eventWindow.events, stateTools);
    session.replayIndex = eventWindow.nextReplayIndex;
    applyReplayStreams(elapsed);
    uiState.replayElapsedMs = elapsed;
    uiState.game.gameClockMs = elapsed;
    renderScoreboard();
    setReplayControlState();
}

function pauseReplay({ syncMedia = true } = {}) {
    uiState.replayPlaying = false;
    if (uiState.replayFrame !== null) cancelAnimationFrame(uiState.replayFrame);
    uiState.replayFrame = null;
    if (syncMedia) syncReplayMedia({ play: false });
    setReplayControlState();
}

function replayTick(stateTools) {
    if (!uiState.replayPlaying) return;
    const elapsed = Math.min(
        uiState.replayDurationMs,
        getReplayElapsedMs(Date.now(), uiState.replayStartTime, uiState.replaySpeed)
    );
    advanceReplayToElapsed(elapsed, stateTools);
    if (elapsed >= uiState.replayDurationMs) {
        pauseReplay();
        return;
    }
    uiState.replayFrame = requestAnimationFrame(() => replayTick(stateTools));
}

function playReplay(stateTools) {
    if (uiState.replayDurationMs <= 0) return;
    if (uiState.replayElapsedMs >= uiState.replayDurationMs) {
        resetReplayToElapsed(0, stateTools);
    }
    uiState.replayPlaying = true;
    uiState.replayStartTime = rebaseReplayStartTimeMs(Date.now(), uiState.replayElapsedMs, uiState.replaySpeed);
    syncReplayMedia({ seek: true, play: true });
    setReplayControlState();
    uiState.replayFrame = requestAnimationFrame(() => replayTick(stateTools));
}

function seekReplay(targetMs, stateTools) {
    resetReplayToElapsed(targetMs, stateTools);
    if (uiState.replayPlaying) {
        uiState.replayStartTime = rebaseReplayStartTimeMs(Date.now(), uiState.replayElapsedMs, uiState.replaySpeed);
    }
    syncReplayMedia({ seek: true });
}

function bindReplayControls(stateTools) {
    elements.replayPlay.onclick = () => {
        if (uiState.replayPlaying) pauseReplay();
        else playReplay(stateTools);
    };
    elements.replayRestart.onclick = () => {
        seekReplay(0, stateTools);
        playReplay(stateTools);
    };
    elements.replayProgress.oninput = (event) => {
        const ratio = Math.min(1, Math.max(0, Number(event.target.value) / 100));
        seekReplay(uiState.replayDurationMs * ratio, stateTools);
    };
    elements.replaySpeeds.forEach((button) => {
        button.onclick = () => {
            const speed = Number(button.dataset.replaySpeed);
            if (!Number.isFinite(speed) || speed <= 0) return;
            if (uiState.replayPlaying) {
                const nowMs = Date.now();
                uiState.replayElapsedMs = getReplayElapsedMs(nowMs, uiState.replayStartTime, uiState.replaySpeed);
                uiState.replayStartTime = getReplayStartTimeAfterSpeedChange(
                    nowMs,
                    uiState.replayStartTime,
                    uiState.replaySpeed,
                    speed,
                    uiState.replayElapsedMs
                );
            }
            uiState.replaySpeed = speed;
            syncReplayMedia();
            setReplayControlState();
        };
    });
}

async function loadReplaySnapshot(database, stateTools, teamId, gameId) {
    uiState.isReplay = true;
    uiState.game.liveStatus = 'replay';
    elements.body.dataset.replay = 'true';
    elements.replayControls.hidden = false;
    setConnectionMessage('Loading replay timeline…', 'info');
    const [eventsResult, chatResult, reactionsResult] = await Promise.allSettled([
        database.getLiveEvents(teamId, gameId),
        database.getLiveChatHistory(teamId, gameId),
        typeof database.getLiveReactions === 'function'
            ? database.getLiveReactions(teamId, gameId)
            : Promise.resolve([])
    ]);

    const replaySession = buildReplaySessionState({
        teamId,
        gameId,
        game: uiState.game.game,
        defaultPeriod: getDefaultLivePeriod({ game: uiState.game.game, team: uiState.game.team }),
        replayEvents: eventsResult.status === 'fulfilled' ? eventsResult.value : [],
        replayChat: chatResult.status === 'fulfilled' ? chatResult.value : [],
        replayReactions: reactionsResult.status === 'fulfilled' ? reactionsResult.value : []
    });
    replaySession.replayIndex = 0;
    replaySession.replayChatIndex = 0;
    replaySession.replayReactionIndex = 0;
    uiState.replaySession = replaySession;
    uiState.replayDurationMs = getOverlayReplayDurationMs({
        ...replaySession,
        videoDurationMs: uiState.videoDurationMs
    });
    uiState.replayElapsedMs = 0;
    bindReplayControls(stateTools);
    resetReplayToElapsed(0, stateTools);

    const failedResults = [eventsResult, chatResult, reactionsResult].filter((result) => result.status === 'rejected');
    if (failedResults.length) {
        console.warn('Some overlay replay history could not be loaded:', failedResults[0].reason);
        setConnectionMessage('Some replay context could not load. The saved video and available game data still work; refresh to retry.');
    } else {
        setConnectionMessage('');
    }
    playReplay(stateTools);
}

function resetVideoElements() {
    elements.iframe.hidden = true;
    elements.iframe.removeAttribute('src');
    elements.recordedVideo.hidden = true;
    elements.recordedVideo.pause();
    elements.recordedVideo.removeAttribute('src');
    elements.recordedVideo.load();
    elements.openStream.hidden = true;
    elements.openStream.removeAttribute('href');
    uiState.videoMode = 'none';
    uiState.videoOrigin = '';
}

function showVideoFallback(message = 'The scoreboard and live context stay ready while video connects.') {
    resetVideoElements();
    elements.videoFallbackCopy.textContent = message;
    elements.videoFallback.hidden = false;
}

function showEmbedVideo(sourceUrl, publicUrl = '', { controllableReplay = false } = {}) {
    const effectiveSourceUrl = controllableReplay
        ? getControllableReplayEmbedUrl(sourceUrl, window.location.origin)
        : sourceUrl;
    if (!elements.iframe.hidden && elements.iframe.getAttribute('src') === effectiveSourceUrl) {
        if (publicUrl) {
            elements.openStream.href = publicUrl;
            elements.openStream.hidden = false;
        }
        return;
    }
    resetVideoElements();
    elements.videoFallback.hidden = true;
    elements.iframe.src = effectiveSourceUrl;
    elements.iframe.hidden = false;
    try {
        const source = new URL(effectiveSourceUrl);
        const isYouTube = ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com']
            .includes(source.hostname.toLowerCase());
        uiState.videoMode = isYouTube ? 'youtube' : 'embed';
        uiState.videoOrigin = source.origin;
    } catch {
        uiState.videoMode = 'embed';
    }
    if (publicUrl) {
        elements.openStream.href = publicUrl;
        elements.openStream.hidden = false;
    }
}

function showRecordedVideo(sourceUrl, publicUrl = '') {
    if (!elements.recordedVideo.hidden && elements.recordedVideo.getAttribute('src') === sourceUrl) {
        if (publicUrl) {
            elements.openStream.href = publicUrl;
            elements.openStream.hidden = false;
        }
        return;
    }
    resetVideoElements();
    elements.videoFallback.hidden = true;
    elements.recordedVideo.src = sourceUrl;
    elements.recordedVideo.hidden = false;
    uiState.videoMode = 'recorded';
    if (publicUrl) {
        elements.openStream.href = publicUrl;
        elements.openStream.hidden = false;
    }
}

function getDemoVideoId(params) {
    const candidate = String(params.videoId || '').trim();
    return /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : 'PK1HyC37doc';
}

function renderPanelVisibility() {
    const mobile = isMobileLayout();
    if (mobile) {
        elements.playsPanel.hidden = uiState.activeMobilePanel !== 'plays';
        elements.insightsPanel.hidden = uiState.activeMobilePanel !== 'insights';
        elements.playsPanel.dataset.mobileActive = String(uiState.activeMobilePanel === 'plays');
        elements.insightsPanel.dataset.mobileActive = String(uiState.activeMobilePanel === 'insights');
    } else {
        elements.playsPanel.hidden = !uiState.desktopPanels.plays;
        elements.insightsPanel.hidden = !uiState.desktopPanels.insights;
        elements.playsPanel.dataset.mobileActive = 'true';
        elements.insightsPanel.dataset.mobileActive = 'true';
    }

    elements.panelToggles.forEach((button) => {
        const panel = button.dataset.panel;
        let pressed = false;
        if (panel === 'plays') pressed = mobile ? uiState.activeMobilePanel === 'plays' : uiState.desktopPanels.plays;
        if (panel === 'insights') pressed = mobile ? uiState.activeMobilePanel === 'insights' && uiState.activeInsight !== 'chat' : uiState.desktopPanels.insights && uiState.activeInsight !== 'chat';
        if (panel === 'chat') pressed = mobile ? uiState.activeMobilePanel === 'insights' && uiState.activeInsight === 'chat' : uiState.desktopPanels.insights && uiState.activeInsight === 'chat';
        button.setAttribute('aria-pressed', String(pressed));
    });
}

function selectInsight(name) {
    uiState.activeInsight = name;
    elements.insightTabs.forEach((tab) => {
        tab.setAttribute('aria-selected', String(tab.id === `${name}-tab`));
    });
    elements.insightViews.forEach((view) => {
        view.hidden = view.id !== `${name}-view`;
    });
    renderPanelVisibility();
}

function togglePanel(panel) {
    const mobile = isMobileLayout();
    if (panel === 'chat') {
        const wasActive = mobile && uiState.activeMobilePanel === 'insights' && uiState.activeInsight === 'chat';
        selectInsight('chat');
        if (mobile) uiState.activeMobilePanel = wasActive ? null : 'insights';
        else uiState.desktopPanels.insights = true;
    } else if (panel === 'insights') {
        if (uiState.activeInsight === 'chat') selectInsight('lineup');
        if (mobile) uiState.activeMobilePanel = uiState.activeMobilePanel === 'insights' ? null : 'insights';
        else uiState.desktopPanels.insights = !uiState.desktopPanels.insights;
    } else if (panel === 'plays') {
        if (mobile) uiState.activeMobilePanel = uiState.activeMobilePanel === 'plays' ? null : 'plays';
        else uiState.desktopPanels.plays = !uiState.desktopPanels.plays;
    }
    renderPanelVisibility();
}

function toggleFocusMode() {
    const enabled = elements.body.dataset.focus !== 'true';
    elements.body.dataset.focus = String(enabled);
    elements.focusToggle.setAttribute('aria-pressed', String(enabled));
    elements.focusToggle.setAttribute('aria-label', enabled ? 'Exit video focus mode' : 'Enter video focus mode');
}

function setDemoLabOpen(open) {
    elements.demoLab.hidden = !open;
    elements.demoLabToggle.setAttribute('aria-expanded', String(open));
    if (open) elements.demoLab.querySelector('button')?.focus();
}

function createDemoEvent(action) {
    const state = uiState.game;
    uiState.demoEventCounter += 1;
    const base = {
        id: `demo-live-${uiState.demoEventCounter}`,
        period: state.period,
        gameClockMs: state.gameClockMs,
        homeScore: state.homeScore,
        awayScore: state.awayScore,
        createdAt: Date.now()
    };
    if (action === 'home-goal') {
        return { ...base, type: 'goal', description: 'Kurtz bends it inside the far post', playerId: 'p11', playerName: 'Bennett Kurtz', playerNumber: '11', statKey: 'goals', value: 1, homeScore: state.homeScore + 1 };
    }
    if (action === 'away-goal') {
        return { ...base, type: 'goal', description: 'Union KC scores from a second-chance finish', isOpponent: true, statKey: 'goals', value: 1, awayScore: state.awayScore + 1 };
    }
    const moments = [
        { type: 'shot', description: 'Persell forces a diving save', playerId: 'p7', playerName: 'Dominic Persell', playerNumber: '7', statKey: 'shots', value: 1 },
        { type: 'corner', description: 'Vipers earn a corner on the right', playerId: 'p4', playerName: 'Ethan August', playerNumber: '4' },
        { type: 'save', description: 'Cole claims the cross under pressure', playerId: 'p1', playerName: 'Mason Cole', playerNumber: '1', statKey: 'saves', value: 1 },
        { type: 'substitution', description: 'Brooks checks in for Kurtz', playerId: 'p9', playerName: 'Nolan Brooks', playerNumber: '9' },
        { type: 'foul', description: 'Union KC concedes a free kick near midfield', isOpponent: true }
    ];
    return { ...base, ...moments[(uiState.demoEventCounter - 1) % moments.length] };
}

function resetDemo() {
    const fixture = createOverlayDemoFixture();
    uiState.game = createOverlayState(fixture);
    uiState.previousHomeScore = null;
    uiState.previousAwayScore = null;
    uiState.latestRenderedEventId = null;
    uiState.demoEventCounter = 0;
    uiState.clockRunning = true;
    updateClockButton();
    renderAll();
}

function updateClockButton() {
    const button = elements.demoActions.find((item) => item.dataset.action === 'toggle-clock');
    if (button) button.textContent = uiState.clockRunning ? 'Pause clock' : 'Run clock';
}

function handleDemoAction(action) {
    if (action === 'reset') {
        resetDemo();
        return;
    }
    if (action === 'toggle-clock') {
        uiState.clockRunning = !uiState.clockRunning;
        updateClockButton();
        return;
    }
    applyOverlayEvents(uiState.game, [createDemoEvent(action)]);
    renderAll();
}

function startDemoClock() {
    window.clearInterval(uiState.clockTimer);
    uiState.clockTimer = window.setInterval(() => {
        if (!uiState.isDemo || !uiState.clockRunning || !uiState.game || uiState.game.gameClockMs <= 0) return;
        uiState.game.gameClockMs = Math.max(0, uiState.game.gameClockMs - 1000);
        renderScoreboard();
    }, 1000);
}

function bindInteractions() {
    elements.panelToggles.forEach((button) => button.addEventListener('click', () => togglePanel(button.dataset.panel)));
    elements.insightTabs.forEach((tab) => tab.addEventListener('click', () => selectInsight(tab.id.replace('-tab', ''))));
    elements.focusToggle.addEventListener('click', toggleFocusMode);
    elements.demoLabToggle.addEventListener('click', () => setDemoLabOpen(elements.demoLab.hidden));
    elements.demoLabClose.addEventListener('click', () => setDemoLabOpen(false));
    elements.demoActions.forEach((button) => button.addEventListener('click', () => handleDemoAction(button.dataset.action)));
    elements.iframe.addEventListener('load', () => {
        if (!uiState.isReplay) return;
        window.setTimeout(() => syncReplayMedia({ seek: true }), 0);
    });
    elements.recordedVideo.addEventListener('loadedmetadata', () => {
        if (!uiState.isReplay || !Number.isFinite(elements.recordedVideo.duration)) return;
        uiState.videoDurationMs = Math.max(0, elements.recordedVideo.duration * 1000);
        if (uiState.replaySession) {
            uiState.replayDurationMs = getOverlayReplayDurationMs({
                ...uiState.replaySession,
                videoDurationMs: uiState.videoDurationMs
            });
            setReplayControlState();
        }
    });
    window.addEventListener('resize', renderPanelVisibility);
    window.addEventListener('keydown', (event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        if (event.key === 'Escape') {
            setDemoLabOpen(false);
            if (isMobileLayout()) uiState.activeMobilePanel = null;
            renderPanelVisibility();
            return;
        }
        if (event.key.toLowerCase() === 'p') togglePanel('plays');
        if (event.key.toLowerCase() === 'i') togglePanel('insights');
        if (event.key.toLowerCase() === 'c') togglePanel('chat');
        if (event.key.toLowerCase() === 'f') toggleFocusMode();
    });
    window.addEventListener('beforeunload', () => {
        window.clearInterval(uiState.clockTimer);
        if (uiState.replayFrame !== null) cancelAnimationFrame(uiState.replayFrame);
        uiState.unsubscribers.forEach((unsubscribe) => {
            try { unsubscribe(); } catch { /* no-op */ }
        });
    });
}

function startDemoMode(params) {
    uiState.isDemo = true;
    elements.demoLabToggle.hidden = false;
    resetDemo();
    const videoId = getDemoVideoId(params);
    showEmbedVideo(
        `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1`,
        `https://www.youtube.com/watch?v=${videoId}`
    );
    setConnectionMessage('Demo mode: use the flask controls to trigger live moments.', 'info');
    window.setTimeout(() => setConnectionMessage(''), 4200);
    startDemoClock();
}

async function startRealMode(params) {
    const teamId = String(params.teamId || '').trim();
    const gameId = String(params.gameId || '').trim();
    if (!teamId || !gameId) {
        showVideoFallback('Add teamId and gameId to load a real game, or add ?demo=1 to explore the prototype.');
        setConnectionMessage('This broadcast view needs a teamId and gameId. Add ?demo=1 for the interactive local demo.');
        setStatus('scheduled');
        return;
    }

    setConnectionMessage('Connecting to the game, event feed, and chat…', 'info');
    try {
        const [database, videoTools, stateTools] = await Promise.all([
            import('./db.js?v=4433176'),
            import('./live-game-video.js?v=443315'),
            import('./live-game-state.js?v=28')
        ]);
        const teamPromise = database.getGameDayTeamContext(teamId, gameId, { includeInactive: true }).catch(() => ({}));
        const playersPromise = database.getPlayers(teamId, { includeInactive: true }).catch(() => []);
        const [team, game, players] = await Promise.all([teamPromise, database.getGame(teamId, gameId), playersPromise]);
        if (!game) throw new Error('Game not found.');

        uiState.game = createOverlayState({ team: team || {}, game, players });
        // The canonical viewer derives home-player stats from the ordered event
        // stream. Keep the demo fixture's seeded stats, but avoid double-counting
        // persisted liveStats when the initial live snapshot arrives.
        uiState.game.stats = {};
        const isReplay = params.replay === 'true';
        uiState.isReplay = isReplay;
        elements.body.dataset.replay = String(isReplay);
        if (isReplay) uiState.game.liveStatus = 'replay';
        renderAll();
        const renderVideoSafely = () => {
            try {
                const options = videoTools.resolveReplayVideoOptions({
                    team: uiState.game.team,
                    game: uiState.game.game,
                    players: uiState.game.players,
                    isReplay
                });
                uiState.videoDurationMs = Number.isFinite(options.durationMs) ? options.durationMs : 0;
                if (options.mode === 'embed' && options.sourceUrl) {
                    showEmbedVideo(options.sourceUrl, options.publicUrl, { controllableReplay: isReplay });
                }
                else if (options.mode === 'recorded' && options.sourceUrl) showRecordedVideo(options.sourceUrl, options.publicUrl);
                else showVideoFallback(options.replayState?.message || 'No video feed is configured for this game yet.');
                return true;
            } catch (error) {
                console.warn('Overlay video refresh failed:', error);
                if (elements.iframe.hidden && elements.recordedVideo.hidden) {
                    showVideoFallback('The video feed is temporarily unavailable. Live score and play updates remain connected.');
                }
                setConnectionMessage('Video refresh is delayed. Score, clock, plays, and chat continue independently.');
                return false;
            }
        };
        if (renderVideoSafely()) setConnectionMessage('');

        if (isReplay) {
            await loadReplaySnapshot(database, stateTools, teamId, gameId);
            return;
        }

        uiState.unsubscribers.push(database.subscribeGame(teamId, gameId, (updatedGame) => {
            if (!updatedGame) return;
            try {
                const resetAt = getTimestampMs(updatedGame.liveResetAt);
                const crossedResetBoundary = resetAt > (uiState.game.lastResetAt || 0);
                if (crossedResetBoundary) uiState.game.lastResetAt = resetAt;
                applyOverlayGame(uiState.game, updatedGame, { preserveEventState: uiState.game.events.length > 0 });
                if (crossedResetBoundary) {
                    resetOverlayFromGame(updatedGame, stateTools);
                } else if (stateTools.shouldResetViewerFromGameDoc(updatedGame, uiState.game)) {
                    resetOverlayFromGame(updatedGame, stateTools);
                } else {
                    renderAll();
                }
                if (renderVideoSafely()) setConnectionMessage('');
            } catch (error) {
                console.warn('Overlay game update could not be applied:', error);
                setConnectionMessage('A score refresh was skipped. Existing video, score, and play data remain available.');
            }
        }, (error) => {
            console.warn('Overlay game subscription failed:', error);
            setConnectionMessage('Live score refresh is delayed. The video remains available; try refreshing if it does not recover.');
        }, { publicProjection: game.isPublicProjection === true }));

        uiState.unsubscribers.push(database.subscribeLiveEvents(teamId, gameId, (events) => {
            try {
                const isInitialLoad = uiState.liveEventsFirstLoad;
                const hadLiveState = uiState.game.events.length > 0 ||
                    Object.keys(uiState.game.stats || {}).length > 0 ||
                    Object.keys(uiState.game.opponentStats || {}).length > 0;
                uiState.liveEventsFirstLoad = false;
                if (!isInitialLoad && events.length === 0 && hadLiveState) {
                    resetOverlayFromGame(uiState.game.game, stateTools);
                    return;
                }
                processLiveEventSnapshot(events, stateTools, { preserveSeededOpponentGoalStats: isInitialLoad });
                setConnectionMessage('');
            } catch (error) {
                console.warn('Overlay event update could not be applied:', error);
                setConnectionMessage('One play update was skipped. Video, scoreboard refresh, and chat continue independently.');
            }
        }, (error) => {
            console.warn('Overlay event subscription failed:', error);
            setConnectionMessage('Play-by-play is temporarily unavailable. Video and scoreboard updates continue independently.');
        }));

        uiState.unsubscribers.push(database.subscribeLiveChat(teamId, gameId, { limit: 100 }, (messages) => {
            replaceOverlayChat(uiState.game, messages);
            renderChat();
        }, (error) => {
            console.warn('Overlay chat subscription failed:', error);
        }));

        uiState.unsubscribers.push(database.subscribeReactions(teamId, gameId, (reaction) => {
            showFloatingReaction(reaction);
        }, (error) => {
            console.warn('Overlay reaction subscription failed:', error);
        }));
    } catch (error) {
        console.warn('Overlay broadcast failed to connect:', error);
        showVideoFallback('The real game could not be loaded in this local environment. Demo mode remains available.');
        setConnectionMessage(`Could not load this game here. Open ${window.location.pathname}?demo=1 to use the interactive local demo.`);
        setStatus('scheduled');
    }
}

async function init() {
    bindInteractions();
    renderPanelVisibility();
    const params = getQueryParams();
    if (params.demo === '1' || params.demo === 'true') startDemoMode(params);
    else await startRealMode(params);
}

init().catch((error) => {
    console.error('Overlay broadcast failed to start:', error);
    showVideoFallback('The overlay broadcast could not start. Refresh the page to try again.');
    setConnectionMessage('The overlay broadcast could not start. Refresh the page to try again.');
});
