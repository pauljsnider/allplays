import {
    applyOverlayEvents,
    applyOverlayGame,
    createOverlayDemoFixture,
    createOverlayState,
    formatOverlayChatMessageHtml,
    formatOverlayClock,
    getControllableReplayEmbedUrl,
    getControllableYouTubeEmbedUrl,
    getOverlayLineup,
    getOverlayLiveClockMs,
    getOverlayReplayDurationMs,
    getOverlayReplayStartAt,
    getSafeOverlayProviderUrl,
    parseYouTubeReplayTelemetry,
    reconcileOverlayLiveEvents,
    replaceOverlayChat
} from './live-game-overlay-model.js?v=14';
import {
    buildReplaySessionState,
    collectReplayEventWindow,
    collectReplayStreamWindow,
    getReplayElapsedMs,
    getReplayStartTimeAfterSpeedChange,
    rebaseReplayStartTimeMs
} from './live-game-replay.js?v=3';
import { getDefaultLivePeriod } from './live-sport-config.js?v=2';
import {
    createSafeImageElement,
    resolveSafeProfilePhotoUrl,
    resolveSafeProfilePhotoWriteUrl
} from './safe-image-url.js?v=1';
import { buildGameWatchShareUrl } from './game-share-links.js?v=1';
import { shareOrCopy } from './utils.js?v=443365';
import { createPlayAnnouncer } from './live-game-announcer.js?v=1';

const elements = {
    body: document.body,
    iframe: document.querySelector('#overlay-video'),
    recordedVideo: document.querySelector('#overlay-recorded-video'),
    videoFallback: document.querySelector('#video-fallback'),
    videoFallbackCopy: document.querySelector('#video-fallback-copy'),
    openStream: document.querySelector('#open-stream'),
    openStreamLabel: document.querySelector('#open-stream-label'),
    watchReplay: document.querySelector('#watch-replay'),
    watchReplayMenu: document.querySelector('#watch-replay-menu'),
    shareGame: document.querySelector('#share-game'),
    shareGameMenu: document.querySelector('#share-game-menu'),
    scoreboardToggle: document.querySelector('#scoreboard-toggle'),
    scoreboardMenuToggle: document.querySelector('#scoreboard-menu-toggle'),
    scoreboardMenuLabel: document.querySelector('#scoreboard-menu-label'),
    muteToggle: document.querySelector('#mute-toggle'),
    fullscreenToggle: document.querySelector('#fullscreen-toggle'),
    broadcastStage: document.querySelector('#broadcast-stage'),
    gameActionsToggle: document.querySelector('#game-actions-toggle'),
    gameActionsMenu: document.querySelector('#game-actions-menu'),
    matchReportLink: document.querySelector('#match-report-link'),
    gameDetailsLink: document.querySelector('#game-details-link'),
    providerMenuLink: document.querySelector('#provider-menu-link'),
    providerMenuLabel: document.querySelector('#provider-menu-label'),
    replayAccessGate: document.querySelector('#replay-access-gate'),
    replayAccessKicker: document.querySelector('#replay-access-kicker'),
    replayAccessTitle: document.querySelector('#replay-access-title'),
    replayAccessCopy: document.querySelector('#replay-access-copy'),
    liveStatus: document.querySelector('#live-status'),
    viewerCount: document.querySelector('#viewer-count'),
    scoreBug: document.querySelector('#score-bug'),
    homeName: document.querySelector('#home-team-name'),
    awayName: document.querySelector('#away-team-name'),
    homeTeamPhoto: document.querySelector('#home-team-photo'),
    awayTeamPhoto: document.querySelector('#away-team-photo'),
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
    opponentList: document.querySelector('#opponent-list'),
    chatList: document.querySelector('#chat-list'),
    chatForm: document.querySelector('#chat-form'),
    chatInput: document.querySelector('#chat-input'),
    chatSend: document.querySelector('#chat-send'),
    chatStatus: document.querySelector('#chat-status'),
    chatSignIn: document.querySelector('#chat-sign-in'),
    chatBadge: document.querySelector('#chat-badge'),
    mentionMenu: document.querySelector('#mention-menu'),
    mentionAllPlays: document.querySelector('#mention-allplays'),
    chatAnonNotice: document.querySelector('#chat-anon-notice'),
    anonName: document.querySelector('#anon-name'),
    anonChange: document.querySelector('#anon-change-btn'),
    anonEdit: document.querySelector('#anon-edit'),
    anonInput: document.querySelector('#anon-input'),
    anonSave: document.querySelector('#anon-save'),
    anonCancel: document.querySelector('#anon-cancel'),
    aiThinking: document.querySelector('#ai-thinking'),
    chatTip: document.querySelector('#chat-tip'),
    chatReactions: document.querySelector('#chat-reactions'),
    chatReactionButtons: [...document.querySelectorAll('[data-chat-reaction]')],
    panelToggles: [...document.querySelectorAll('[data-panel]')],
    insightTabs: [...document.querySelectorAll('[role="tab"][aria-controls]')],
    insightViews: [...document.querySelectorAll('[role="tabpanel"]')],
    focusToggle: document.querySelector('#focus-toggle'),
    announcerToggle: document.querySelector('#announcer-toggle'),
    announcerPause: document.querySelector('#announcer-pause'),
    announcerStatus: document.querySelector('#announcer-status'),
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
    replayScanStatus: document.querySelector('#replay-scan-status'),
    replayScanSpeed: document.querySelector('#replay-scan-speed'),
    connectionMessage: document.querySelector('#connection-message'),
    actionToast: document.querySelector('#action-toast'),
    reactionsOverlay: document.querySelector('#reactions-overlay'),
    screenReaderUpdate: document.querySelector('#screen-reader-update')
};

const uiState = {
    game: null,
    isDemo: false,
    clockRunning: false,
    clockTimer: null,
    liveClockSnapshotMs: 0,
    liveClockSnapshotAt: 0,
    demoEventCounter: 0,
    previousHomeScore: null,
    previousAwayScore: null,
    latestRenderedEventId: null,
    activeMobilePanel: null,
    desktopPanels: { plays: true, insights: true },
    activeInsight: 'lineup',
    hasLiveEventSnapshot: false,
    lastLiveEvents: [],
    reactionIds: new Set(),
    isReplay: false,
    replaySession: null,
    replayPlaying: false,
    replaySpeed: 1,
    replayStartTime: null,
    replayElapsedMs: 0,
    replayDurationMs: 0,
    replayFrame: null,
    replayStateTools: null,
    replayHistoryStatus: 'pending',
    videoMode: 'none',
    videoOrigin: '',
    videoMuted: true,
    scoreboardHidden: false,
    videoRequestId: 0,
    optionalTeamStatus: 'pending',
    optionalPlayersStatus: 'pending',
    teamEntitlement: null,
    teamEntitlementPromise: null,
    teamEntitlementKey: '',
    videoDurationMs: 0,
    recentMediaSeekTargets: [],
    teamId: '',
    gameId: '',
    chatUser: null,
    chatEnabled: false,
    chatBusy: false,
    chatControlsReady: false,
    chatSubmitBound: false,
    chatParityBound: false,
    unreadChatCount: 0,
    lastChatSeenAt: Date.now(),
    lastChatSentAt: 0,
    anonName: '',
    chatServices: null,
    connectionIssues: new Map(),
    unsubscribers: []
};

const playAnnouncer = createPlayAnnouncer();
let actionToastTimer = null;
let connectionIssueSequence = 0;

const mentionState = {
    active: false,
    atPos: null
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

function isValidDocumentId(value) {
    const candidate = String(value || '').trim();
    if (!candidate || candidate === '.' || candidate === '..' || candidate.includes('/')) return false;
    return new TextEncoder().encode(candidate).length <= 1500;
}

function usesCompactPanelLayout() {
    return window.matchMedia('(max-width: 900px)').matches ||
        (uiState.isReplay && window.matchMedia('(max-width: 1320px)').matches);
}

function loadOverlayDatabase() {
    return import('./db.js?v=4433189');
}

function getTimestampMs(value) {
    if (Number.isFinite(value)) return Number(value);
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value && typeof value.toDate === 'function') return value.toDate().getTime();
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function renderConnectionMessage() {
    if (!elements.connectionMessage) return;
    const tonePriority = { error: 3, warning: 2, info: 1 };
    const activeIssues = [...uiState.connectionIssues.values()].sort((left, right) => (
        (tonePriority[right.tone] || 0) - (tonePriority[left.tone] || 0)
        || right.sequence - left.sequence
    ));
    const issue = activeIssues[0] || null;
    elements.connectionMessage.textContent = issue?.message || '';
    elements.connectionMessage.dataset.tone = issue?.tone || 'warning';
    elements.connectionMessage.hidden = !issue;
}

function setConnectionIssue(channel, message = '', tone = 'warning') {
    const key = String(channel || 'general');
    if (message) {
        uiState.connectionIssues.set(key, {
            message,
            tone,
            sequence: ++connectionIssueSequence
        });
    } else {
        uiState.connectionIssues.delete(key);
    }
    renderConnectionMessage();
}

function setConnectionMessage(message = '', tone = 'warning') {
    setConnectionIssue('general', message, tone);
}

function showActionToast(message) {
    window.clearTimeout(actionToastTimer);
    elements.actionToast.textContent = message;
    elements.actionToast.hidden = false;
    actionToastTimer = window.setTimeout(() => {
        elements.actionToast.hidden = true;
    }, 2600);
}

function closeGameActionsMenu({ restoreFocus = false } = {}) {
    elements.gameActionsMenu.hidden = true;
    elements.gameActionsToggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) elements.gameActionsToggle.focus();
}

function toggleGameActionsMenu() {
    const open = elements.gameActionsMenu.hidden;
    elements.gameActionsMenu.hidden = !open;
    elements.gameActionsToggle.setAttribute('aria-expanded', String(open));
    if (open) elements.gameActionsMenu.querySelector('[role^="menuitem"]')?.focus();
}

function isCompletedGame() {
    return [
        uiState.game?.game?.liveStatus,
        uiState.game?.game?.status,
        uiState.game?.game?.state,
        uiState.game?.liveStatus
    ].some((value) => ['completed', 'final'].includes(String(value || '').toLowerCase()));
}

function getDisplayedLiveClockMs() {
    return getOverlayLiveClockMs({
        snapshotClockMs: uiState.liveClockSnapshotMs,
        snapshotAtMs: uiState.liveClockSnapshotAt,
        nowMs: Date.now(),
        clockRunning: uiState.game?.clockRunning === true,
        isReplay: uiState.isReplay,
        isCompleted: isCompletedGame()
    });
}

function captureLiveClockState() {
    return {
        displayedClockMs: getDisplayedLiveClockMs(),
        gameClockMs: Number(uiState.game?.gameClockMs) || 0,
        clockRunning: uiState.game?.clockRunning === true,
        completed: isCompletedGame()
    };
}

function syncLiveClockAnchor(previous = null) {
    const gameClockMs = Math.max(0, Number(uiState.game?.gameClockMs) || 0);
    const clockRunning = uiState.game?.clockRunning === true;
    const completed = isCompletedGame();
    if (!previous || gameClockMs !== previous.gameClockMs) {
        uiState.liveClockSnapshotMs = gameClockMs;
        uiState.liveClockSnapshotAt = Date.now();
        return;
    }
    if (clockRunning !== previous.clockRunning || completed !== previous.completed) {
        uiState.liveClockSnapshotMs = clockRunning && !completed
            ? gameClockMs
            : previous.displayedClockMs;
        uiState.liveClockSnapshotAt = Date.now();
    }
}

function getOverlayReplayHref() {
    return `live-game-overlay.html?teamId=${encodeURIComponent(uiState.teamId)}&gameId=${encodeURIComponent(uiState.gameId)}&replay=true`;
}

function configureGameActions() {
    if (!uiState.teamId || !uiState.gameId) return;
    const gameHref = `game.html#teamId=${encodeURIComponent(uiState.teamId)}&gameId=${encodeURIComponent(uiState.gameId)}`;
    elements.matchReportLink.href = gameHref;
    elements.matchReportLink.hidden = !(uiState.isReplay || isCompletedGame());
    elements.gameDetailsLink.href = gameHref;
    const replayAvailable = !uiState.isReplay && isCompletedGame();
    const replayHref = getOverlayReplayHref();
    elements.watchReplay.href = replayHref;
    elements.watchReplay.hidden = !replayAvailable;
    elements.watchReplayMenu.href = replayHref;
    elements.watchReplayMenu.hidden = !replayAvailable;
}

async function shareGame() {
    if (!uiState.teamId || !uiState.gameId || !uiState.game) return;
    const shareReplay = uiState.isReplay || isCompletedGame();
    const url = buildGameWatchShareUrl({
        teamId: uiState.teamId,
        gameId: uiState.gameId,
        replay: shareReplay
    });
    const homeName = uiState.game.homeName || 'Team';
    const awayName = uiState.game.awayName || 'Opponent';
    const text = `Watch ${homeName} vs ${awayName}`;
    const result = await shareOrCopy({
        title: shareReplay ? 'Watch replay' : 'Watch game',
        text,
        url,
        clipboardText: `${text}\n${url}`
    });
    closeGameActionsMenu();
    if (result.status === 'shared') showActionToast('Share sheet opened.');
    else if (result.status === 'copied') showActionToast('Game link copied.');
    else if (result.status === 'failed') showActionToast('Could not share this game. Copy the address from your browser.');
}

function setProviderLink(publicUrl = '', publicLabel = 'Open video ↗') {
    let label = String(publicLabel || 'Open video ↗').trim();
    const safePublicUrl = getSafeOverlayProviderUrl(publicUrl);
    if (!safePublicUrl) {
        elements.openStream.hidden = true;
        elements.openStream.removeAttribute('href');
        elements.providerMenuLink.hidden = true;
        elements.providerMenuLink.removeAttribute('href');
        return;
    }
    if (/^Open video\s*↗?$/i.test(label)) {
        try {
            const providerHost = new URL(safePublicUrl).hostname.toLowerCase();
            if (providerHost === 'youtu.be' || providerHost.endsWith('youtube.com')) label = 'Watch on YouTube ↗';
            else if (providerHost.endsWith('twitch.tv')) label = 'Watch on Twitch ↗';
        } catch { /* keep the generic validated label */ }
    }
    elements.openStream.href = safePublicUrl;
    elements.openStreamLabel.textContent = label.replace(/\s*↗\s*$/, '');
    elements.openStream.setAttribute('aria-label', label.replace(/\s*↗\s*$/, ''));
    elements.openStream.hidden = false;
    elements.providerMenuLink.href = safePublicUrl;
    elements.providerMenuLabel.textContent = label.replace(/\s*↗\s*$/, '');
    elements.providerMenuLink.hidden = false;
}

function updateMuteControl() {
    const controllable = uiState.videoMode === 'youtube' || uiState.videoMode === 'recorded';
    elements.muteToggle.hidden = !controllable;
    elements.muteToggle.dataset.muted = String(uiState.videoMuted);
    elements.muteToggle.setAttribute('aria-pressed', String(!uiState.videoMuted));
    elements.muteToggle.setAttribute('aria-label', uiState.videoMuted ? 'Unmute video' : 'Mute video');
}

function toggleVideoMute() {
    if (uiState.videoMode !== 'youtube' && uiState.videoMode !== 'recorded') return;
    uiState.videoMuted = !uiState.videoMuted;
    if (uiState.videoMode === 'youtube') {
        sendYouTubeCommand(uiState.videoMuted ? 'mute' : 'unMute');
    } else {
        elements.recordedVideo.muted = uiState.videoMuted;
    }
    updateMuteControl();
    elements.screenReaderUpdate.textContent = uiState.videoMuted ? 'Video muted.' : 'Video unmuted.';
}

function updateScoreboardVisibility() {
    const hidden = uiState.scoreboardHidden;
    elements.body.dataset.scoreHidden = String(hidden);
    elements.scoreBug.setAttribute('aria-hidden', String(hidden));
    elements.scoreboardToggle.setAttribute('aria-pressed', String(hidden));
    elements.scoreboardToggle.setAttribute('aria-label', hidden ? 'Show scoreboard' : 'Hide scoreboard');
    elements.scoreboardToggle.title = hidden ? 'Show scoreboard' : 'Hide scoreboard';
    elements.scoreboardMenuToggle.setAttribute('aria-checked', String(hidden));
    elements.scoreboardMenuLabel.textContent = hidden ? 'Show scoreboard' : 'Hide scoreboard';
}

function toggleScoreboardVisibility({ closeMenu = false } = {}) {
    uiState.scoreboardHidden = !uiState.scoreboardHidden;
    updateScoreboardVisibility();
    if (closeMenu) closeGameActionsMenu();
    const message = uiState.scoreboardHidden ? 'Scoreboard hidden.' : 'Scoreboard shown.';
    showActionToast(message);
    elements.screenReaderUpdate.textContent = message;
}

function updateFullscreenControl() {
    const fullscreen = document.fullscreenElement === elements.broadcastStage;
    elements.fullscreenToggle.setAttribute('aria-pressed', String(fullscreen));
    elements.fullscreenToggle.setAttribute('aria-label', fullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
}

async function toggleFullscreen() {
    try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (elements.broadcastStage.requestFullscreen) await elements.broadcastStage.requestFullscreen();
        else showActionToast('Fullscreen is not available in this browser.');
    } catch {
        showActionToast('Fullscreen could not be opened.');
    }
    updateFullscreenControl();
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

function renderTeamPhoto(image, value, alt) {
    const safeUrl = resolveSafeProfilePhotoUrl(value);
    if (!safeUrl) {
        delete image.dataset.source;
        image.hidden = true;
        image.removeAttribute('src');
        image.alt = '';
        return;
    }
    if (image.dataset.source === safeUrl) {
        if (!image.hidden) image.alt = alt;
        return;
    }
    image.dataset.source = safeUrl;
    image.src = safeUrl;
    image.alt = alt;
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    image.hidden = false;
    image.onerror = () => {
        image.hidden = true;
        image.removeAttribute('src');
        image.alt = '';
    };
}

function renderScoreboard() {
    const state = uiState.game;
    if (!state) return;
    const displayedClockMs = uiState.isDemo ? state.gameClockMs : getDisplayedLiveClockMs();
    elements.homeName.textContent = state.homeName;
    elements.awayName.textContent = state.awayName;
    renderTeamPhoto(elements.homeTeamPhoto, state.team?.photoUrl, `${state.homeName} team photo`);
    renderTeamPhoto(elements.awayTeamPhoto, state.game?.opponentTeamPhoto, `${state.awayName} team photo`);
    elements.homeScore.textContent = String(state.homeScore);
    elements.awayScore.textContent = String(state.awayScore);
    elements.period.textContent = state.period;
    elements.gameClock.textContent = formatOverlayClock(displayedClockMs);
    elements.gameClock.dateTime = `PT${Math.floor(displayedClockMs / 60000)}M${Math.floor((displayedClockMs % 60000) / 1000)}S`;
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
    const displayPeriod = event.period || uiState.game?.period || '—';
    const displayClockMs = event.gameClockMs ?? uiState.game?.gameClockMs ?? 0;
    const context = document.createElement('div');
    context.className = 'event-context';
    context.appendChild(createTextElement('span', '', `${displayPeriod} · ${formatOverlayClock(displayClockMs)}`));
    if (event.tone !== 'system') {
        context.appendChild(createTextElement('span', 'event-side-tag', event.isOpponent ? 'Away' : 'Home'));
    }
    meta.appendChild(context);
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
    const isNewLatest = Boolean(
        latestId &&
        latestId !== uiState.latestRenderedEventId &&
        (uiState.latestRenderedEventId || uiState.hasLiveEventSnapshot || uiState.isReplay)
    );
    elements.eventList.replaceChildren();
    if (!state.events.length) {
        const emptyCopy = uiState.isReplay && uiState.replayHistoryStatus === 'failed'
            ? 'Replay timeline is temporarily unavailable. Refresh to retry.'
            : uiState.isReplay
            ? 'Replay ready. Press play or scrub the timeline to revisit the game.'
            : 'Connected. Waiting for the first play…';
        elements.eventList.appendChild(createTextElement('li', 'empty-state', emptyCopy));
    } else {
        state.events.slice(0, 60).forEach((event, index) => {
            elements.eventList.appendChild(renderEventCard(event, isNewLatest && index === 0));
        });
    }

    const latest = state.latestEvent;
    if (latest) {
        elements.heroEvent.dataset.tone = latest.tone;
        elements.heroEventLabel.textContent = latest.label || 'Latest play';
        elements.heroEventDescription.textContent = latest.description;
        elements.heroEventTime.textContent = `${latest.period || state.period || '—'} · ${formatOverlayClock(latest.gameClockMs ?? state.gameClockMs)}`;
        if (isNewLatest) {
            elements.screenReaderUpdate.textContent = `${latest.description}. Score ${state.homeScore} to ${state.awayScore}.`;
            playAnnouncer.announceEvent(latest, { playbackSessionId: uiState.isReplay ? 'replay' : 'live' });
        }
    } else {
        elements.heroEvent.dataset.tone = 'system';
        elements.heroEventLabel.textContent = uiState.isReplay && uiState.replayHistoryStatus === 'failed'
            ? 'Replay unavailable'
            : uiState.isReplay ? 'Replay ready' : 'Latest play';
        elements.heroEventDescription.textContent = uiState.isReplay && uiState.replayHistoryStatus === 'failed'
            ? 'The saved event timeline could not be loaded. Refresh to retry.'
            : uiState.isReplay
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

function renderOpponentStats() {
    const state = uiState.game;
    if (!state || !elements.opponentList) return;
    const opponents = Object.entries(state.opponentStats || {})
        .map(([id, stats]) => ({
            id,
            name: String(stats?.name || stats?.playerName || 'Opponent player'),
            number: String(stats?.number || stats?.playerNumber || ''),
            position: 'Opponent',
            stats: stats || {}
        }))
        .sort((left, right) => {
            const leftTotal = Object.values(left.stats).reduce((sum, value) => sum + (Number(value) || 0), 0);
            const rightTotal = Object.values(right.stats).reduce((sum, value) => sum + (Number(value) || 0), 0);
            return rightTotal - leftTotal || left.name.localeCompare(right.name);
        });
    renderLineupList(elements.opponentList, opponents, 'Opponent stats will appear as they are tracked.');
}

function renderAnnouncerControls() {
    const supported = playAnnouncer.isSupported();
    const enabled = playAnnouncer.isEnabled();
    const paused = playAnnouncer.isPaused();
    elements.announcerToggle.disabled = !supported;
    elements.announcerToggle.textContent = enabled ? 'Stop announcer' : 'Listen live';
    elements.announcerToggle.setAttribute('aria-pressed', String(enabled));
    elements.announcerPause.hidden = !enabled;
    elements.announcerPause.textContent = paused ? 'Resume' : 'Pause';
    elements.announcerPause.setAttribute('aria-pressed', String(paused));
    if (!supported) elements.announcerStatus.textContent = 'Play announcer is not supported in this browser.';
    else if (!enabled) elements.announcerStatus.textContent = 'Opt in to hear new plays during live games and replay.';
    else if (paused) elements.announcerStatus.textContent = 'Announcer paused.';
    else elements.announcerStatus.textContent = uiState.isReplay ? 'Replay announcer on.' : 'Live announcer on.';
}

function renderChat() {
    const state = uiState.game;
    if (!state) return;
    elements.chatList.replaceChildren();
    if (!state.chatMessages.length) {
        uiState.unreadChatCount = 0;
        updateChatBadge();
        elements.chatList.appendChild(createTextElement(
            'li',
            'empty-state',
            uiState.isReplay ? 'Saved conversation will appear with the replay timeline.' : 'Live chat is quiet right now.'
        ));
        return;
    }
    state.chatMessages.slice(0, 24).reverse().forEach((message) => {
        const senderName = String(message.senderName || 'Fan');
        const isAi = false;
        const item = document.createElement('li');
        item.className = 'chat-row';
        item.dataset.ai = String(isAi);

        const fallback = createTextElement('span', 'chat-avatar', isAi ? 'AP' : senderName.charAt(0).toUpperCase());
        const avatar = createSafeImageElement({
            url: message.senderPhotoUrl,
            resolveUrl: resolveSafeProfilePhotoUrl,
            alt: `${senderName} profile photo`,
            className: 'chat-avatar',
            onLoadError: (image) => image.replaceWith(fallback)
        });
        item.appendChild(avatar || fallback);

        const content = document.createElement('div');
        content.appendChild(createTextElement('strong', '', isAi ? 'ALL PLAYS' : senderName));
        const copy = document.createElement('p');
        copy.className = 'chat-message';
        copy.innerHTML = formatOverlayChatMessageHtml(message.text || '');
        content.appendChild(copy);
        item.appendChild(content);
        elements.chatList.appendChild(item);
    });
    elements.chatList.scrollTop = elements.chatList.scrollHeight;
    updateChatUnread();
}

function updateChatBadge() {
    if (!elements.chatBadge) return;
    elements.chatBadge.textContent = uiState.unreadChatCount > 99 ? '99+' : String(uiState.unreadChatCount);
    elements.chatBadge.hidden = uiState.unreadChatCount === 0;
}

function markChatSeen() {
    uiState.lastChatSeenAt = Date.now();
    uiState.unreadChatCount = 0;
    updateChatBadge();
}

function updateChatUnread() {
    if (!uiState.game?.chatMessages.length) return;
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    const chatIsOpen = uiState.activeInsight === 'chat' && (
        !usesCompactPanelLayout() || uiState.activeMobilePanel === 'insights'
    );
    if (!isMobile || chatIsOpen) {
        markChatSeen();
        return;
    }
    uiState.unreadChatCount = uiState.game.chatMessages.reduce((count, message) => {
        const timestamp = Number(message.createdAtMs) || 0;
        return !timestamp || timestamp > uiState.lastChatSeenAt ? count + 1 : count;
    }, 0);
    updateChatBadge();
}

function getChatSenderName() {
    const name = uiState.anonName || uiState.chatUser?.displayName || 'Fan';
    return isReservedChatDisplayName(name) ? 'Fan' : String(name).trim().slice(0, 80) || 'Fan';
}

function isReservedChatDisplayName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase() === 'ALL PLAYS';
}

function getChatNameStorageKey() {
    return uiState.chatUser?.uid
        ? `liveChatDisplayName:${uiState.chatUser.uid}`
        : 'liveChatAnonName';
}

function ensureChatDisplayName() {
    if (uiState.anonName) return uiState.anonName;
    let saved = '';
    try {
        saved = String(sessionStorage.getItem(getChatNameStorageKey()) || '').replace(/\s+/g, ' ').trim().slice(0, 20);
    } catch {
        // Storage can be unavailable in privacy-restricted browsers. The
        // generated name still works for this page view.
    }
    const authenticatedName = String(uiState.chatUser?.displayName || '').replace(/\s+/g, ' ').trim().slice(0, 20);
    const preferredName = saved.length >= 2 ? saved : authenticatedName;
    uiState.anonName = preferredName && !isReservedChatDisplayName(preferredName)
        ? preferredName
        : `Fan${Math.floor(1000 + Math.random() * 9000)}`;
    try {
        sessionStorage.setItem(getChatNameStorageKey(), uiState.anonName);
    } catch {
        // Display-name persistence is optional and must not affect the game.
    }
    if (elements.anonName) elements.anonName.textContent = uiState.anonName;
    return uiState.anonName;
}

function openAnonNameEditor() {
    if (!elements.anonEdit || !elements.anonInput) return;
    elements.anonEdit.hidden = false;
    elements.anonInput.value = ensureChatDisplayName();
    elements.anonInput.focus();
}

function closeAnonNameEditor() {
    if (elements.anonEdit) elements.anonEdit.hidden = true;
}

function saveAnonName() {
    if (!elements.anonInput) return;
    const cleaned = elements.anonInput.value.replace(/\s+/g, ' ').trim();
    if (cleaned.length < 2) {
        setChatStatus('Name must be at least 2 characters.', 'error');
        return;
    }
    if (isReservedChatDisplayName(cleaned)) {
        setChatStatus('ALL PLAYS is a reserved name.', 'error');
        return;
    }
    uiState.anonName = cleaned.slice(0, 20);
    try {
        sessionStorage.setItem(getChatNameStorageKey(), uiState.anonName);
    } catch {
        // The in-memory name remains usable when storage is unavailable.
    }
    if (elements.anonName) elements.anonName.textContent = uiState.anonName;
    closeAnonNameEditor();
    setChatStatus(`Name changed to ${uiState.anonName}.`, 'success');
}

function hideMentionMenu() {
    mentionState.active = false;
    mentionState.atPos = null;
    if (elements.mentionMenu) elements.mentionMenu.hidden = true;
    elements.chatInput?.setAttribute('aria-expanded', 'false');
}

function handleMentionInput() {
    if (!elements.chatInput || !elements.mentionMenu) return;
    const text = elements.chatInput.value;
    const cursor = elements.chatInput.selectionStart ?? text.length;
    const atPos = text.lastIndexOf('@', Math.max(0, cursor - 1));
    if (atPos === -1) {
        hideMentionMenu();
        return;
    }
    const token = text.slice(atPos, cursor);
    const prefix = token.slice(1).toLowerCase();
    if (!/^[^\s@]*$/.test(prefix) || (token.length > 1 && !'allplays'.startsWith(prefix)) || token.length > 20) {
        hideMentionMenu();
        return;
    }
    mentionState.active = true;
    mentionState.atPos = atPos;
    elements.mentionMenu.hidden = false;
    elements.chatInput.setAttribute('aria-expanded', 'true');
}

function insertMention() {
    if (!elements.chatInput || mentionState.atPos === null) return;
    const text = elements.chatInput.value;
    const cursor = elements.chatInput.selectionStart ?? text.length;
    const before = text.slice(0, mentionState.atPos);
    const after = text.slice(cursor);
    const mention = '@ALL PLAYS ';
    elements.chatInput.value = `${before}${mention}${after}`;
    const nextCursor = before.length + mention.length;
    elements.chatInput.setSelectionRange(nextCursor, nextCursor);
    hideMentionMenu();
    elements.chatInput.focus();
}

function handleMentionKeydown(event) {
    if (!mentionState.active) return;
    if (event.key === 'Escape') hideMentionMenu();
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        insertMention();
    }
}

function buildAiPrompt(question) {
    const recentEvents = uiState.game.events.slice(0, 20).reverse().map((event) => (
        `${event.period || ''} ${formatOverlayClock(event.gameClockMs || 0)} - ${event.description}`
    )).join('\n');
    const statLines = uiState.game.players.map((player) => {
        const stats = uiState.game.stats[player.id] || {};
        const values = Object.entries(stats)
            .filter(([, value]) => Number(value) !== 0)
            .map(([key, value]) => `${key.toUpperCase()} ${value}`)
            .join(', ');
        return `${player.number ? `#${player.number} ` : ''}${player.name}: ${values || 'No stats'}`;
    }).join('\n');
    const chatContext = uiState.game.chatMessages.slice(0, 10).reverse()
        .map((message) => `${message.senderName || 'Fan'}: ${message.text}`)
        .join('\n');

    return `You are ALL PLAYS, a helpful game assistant for a live sports broadcast.\n\nCurrent score: ${uiState.game.homeScore} - ${uiState.game.awayScore}\nPeriod: ${uiState.game.period}\nClock: ${formatOverlayClock(uiState.game.gameClockMs)}\n\nRecent plays:\n${recentEvents || 'No events yet.'}\n\nPlayer stats:\n${statLines || 'No stats yet.'}\n\nRecent chat:\n${chatContext || 'No chat yet.'}\n\nQuestion: ${question}\n\nRespond in a concise, friendly broadcast tone.`;
}

async function generateAiResponse(question) {
    if (!uiState.chatUser?.uid || !uiState.chatServices) return;
    if (elements.aiThinking) elements.aiThinking.hidden = false;
    try {
        const [aiTools, appTools] = await Promise.all([
            import('./vendor/firebase-ai.js'),
            import('./vendor/firebase-app.js')
        ]);
        const ai = aiTools.getAI(appTools.getApp(), { backend: new aiTools.GoogleAIBackend() });
        const model = aiTools.getGenerativeModel(ai, { model: 'gemini-2.5-flash' });
        const result = await model.generateContent(buildAiPrompt(question));
        const text = String(result.response.text() || '').trim();
        if (!text) throw new Error('ALL PLAYS returned an empty response.');
        await uiState.chatServices.postLiveChatMessage(uiState.teamId, uiState.gameId, {
            text: `ALL PLAYS: ${text}`,
            senderId: uiState.chatUser.uid,
            senderName: getChatSenderName(),
            senderPhotoUrl: null,
            isAnonymous: false
        });
    } catch (error) {
        console.warn('Overlay ALL PLAYS response failed:', error);
        try {
            await uiState.chatServices.postLiveChatMessage(uiState.teamId, uiState.gameId, {
                text: 'ALL PLAYS is unavailable right now.',
                senderId: uiState.chatUser.uid,
                senderName: getChatSenderName(),
                senderPhotoUrl: null,
                isAnonymous: false
            });
        } catch (postError) {
            console.warn('Overlay ALL PLAYS fallback failed:', postError);
            setChatStatus('ALL PLAYS could not answer. Live game updates continue.', 'error');
        }
    } finally {
        if (elements.aiThinking) elements.aiThinking.hidden = true;
    }
}

async function sendChatReaction(button) {
    if (!uiState.chatServices || !uiState.chatEnabled || !uiState.chatUser?.uid || button.disabled) return;
    const type = String(button.dataset.chatReaction || '');
    const emoji = getReactionEmoji(type);
    button.disabled = true;
    button.dataset.cooldown = 'true';
    window.setTimeout(() => {
        delete button.dataset.cooldown;
        button.disabled = !(uiState.chatEnabled && uiState.chatUser?.uid && !uiState.isReplay);
    }, 1000);

    const payload = {
        senderId: uiState.chatUser.uid,
        senderName: getChatSenderName(),
        senderPhotoUrl: resolveSafeProfilePhotoWriteUrl(uiState.chatUser.photoURL) || null,
        isAnonymous: false
    };
    const reactionRequest = typeof uiState.chatServices.sendReaction === 'function'
        ? uiState.chatServices.sendReaction(uiState.teamId, uiState.gameId, {
            type,
            senderId: uiState.chatUser.uid
        })
        : Promise.reject(new Error('Live reactions are unavailable.'));
    const results = await Promise.allSettled([
        reactionRequest,
        uiState.chatServices.postLiveChatMessage(uiState.teamId, uiState.gameId, {
            ...payload,
            text: emoji
        })
    ]);
    if (results.every((result) => result.status === 'rejected')) {
        setChatStatus('Reaction failed to send. Live game updates continue.', 'error');
    }
}

function setChatStatus(message, tone = 'neutral') {
    if (!elements.chatStatus) return;
    elements.chatStatus.textContent = message;
    elements.chatStatus.dataset.tone = tone;
}

function getChatSignInUrl() {
    const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return `login.html?next=${encodeURIComponent(returnPath)}`;
}

function renderChatComposer(statusOverride = null) {
    if (!elements.chatForm || !elements.chatInput || !elements.chatSend) return;
    const canShowComposer = !uiState.isDemo && !uiState.isReplay;
    elements.chatForm.hidden = !canShowComposer;
    if (!canShowComposer) {
        hideMentionMenu();
        if (elements.chatReactions) elements.chatReactions.hidden = true;
        return;
    }

    const signedIn = Boolean(uiState.chatUser?.uid);
    const canSend = uiState.chatControlsReady && uiState.chatEnabled && signedIn && !uiState.chatBusy;
    elements.chatInput.disabled = !canSend;
    elements.chatSend.disabled = !canSend;
    elements.chatInput.placeholder = uiState.chatEnabled
        ? (signedIn ? 'Send a message…' : 'Sign in to join chat')
        : 'Chat opens on game day';

    if (elements.chatSignIn) {
        elements.chatSignIn.href = getChatSignInUrl();
        elements.chatSignIn.hidden = !uiState.chatControlsReady || !uiState.chatEnabled || signedIn;
    }
    if (signedIn) ensureChatDisplayName();
    if (elements.chatAnonNotice) elements.chatAnonNotice.hidden = !uiState.chatEnabled || !signedIn;
    if (elements.chatTip) elements.chatTip.hidden = !uiState.chatEnabled;
    if (elements.chatReactions) elements.chatReactions.hidden = !canSend;
    elements.chatReactionButtons.forEach((button) => {
        if (!button.dataset.cooldown) button.disabled = !canSend;
    });
    if (!canSend) hideMentionMenu();
    if (!signedIn) closeAnonNameEditor();

    if (statusOverride) {
        setChatStatus(statusOverride.message, statusOverride.tone);
    } else if (!uiState.chatControlsReady) {
        setChatStatus('Chat controls are temporarily unavailable. Live updates continue.', 'error');
    } else if (!uiState.chatEnabled) {
        setChatStatus('Chat is read-only until game day.');
    } else if (!signedIn) {
        setChatStatus('Sign in to join the live conversation.');
    } else if (uiState.chatBusy) {
        setChatStatus('Sending…');
    } else {
        setChatStatus(`Chatting as ${getChatSenderName()}`);
    }
}

function refreshChatAvailability() {
    const availability = uiState.chatServices?.isViewerChatEnabled;
    uiState.chatEnabled = Boolean(
        availability && uiState.game && availability(uiState.game.game, { isReplay: uiState.isReplay })
    );
    renderChatComposer();
}

async function submitChatMessage(event) {
    event.preventDefault();
    if (!uiState.chatServices || !uiState.chatEnabled || !uiState.chatUser?.uid || uiState.chatBusy) {
        renderChatComposer();
        return;
    }

    const text = String(elements.chatInput?.value || '').trim();
    if (!text) return;
    if (text.length > 2000) {
        renderChatComposer({ message: 'Messages must be 2,000 characters or fewer.', tone: 'error' });
        return;
    }
    if (Date.now() - uiState.lastChatSentAt < 1500) {
        renderChatComposer({ message: 'Please wait a moment before sending another message.', tone: 'error' });
        return;
    }

    uiState.lastChatSentAt = Date.now();
    uiState.chatBusy = true;
    elements.chatInput.value = '';
    hideMentionMenu();
    renderChatComposer();

    const hasAiMention = /@all\s*plays/i.test(text);
    try {
        await uiState.chatServices.postLiveChatMessage(uiState.teamId, uiState.gameId, {
            text,
            senderId: uiState.chatUser.uid,
            senderName: getChatSenderName(),
            senderPhotoUrl: resolveSafeProfilePhotoWriteUrl(uiState.chatUser.photoURL) || null,
            isAnonymous: false
        });
        uiState.chatBusy = false;
        renderChatComposer({ message: 'Message sent.', tone: 'success' });
        if (hasAiMention) await generateAiResponse(text);
    } catch (error) {
        console.warn('Overlay chat send failed:', error);
        uiState.chatBusy = false;
        elements.chatInput.value = text;
        renderChatComposer({ message: 'Message failed to send. Score and video remain connected.', tone: 'error' });
    }
}

async function initializeChatComposer(database, teamId, gameId) {
    uiState.teamId = teamId;
    uiState.gameId = gameId;
    if (!elements.chatForm) return;

    try {
        const [authTools, chatTools] = await Promise.all([
            import('./auth.js?v=4433193'),
            import('./live-game-chat.js?v=2')
        ]);
        uiState.chatServices = {
            postLiveChatMessage: database.postLiveChatMessage,
            isViewerChatEnabled: chatTools.isViewerChatEnabled,
            sendReaction: database.sendReaction
        };
        uiState.chatControlsReady = true;
        if (!uiState.chatSubmitBound) {
            elements.chatForm.addEventListener('submit', submitChatMessage);
            uiState.chatSubmitBound = true;
        }
        if (!uiState.chatParityBound) {
            elements.chatInput.addEventListener('input', handleMentionInput);
            elements.chatInput.addEventListener('keydown', handleMentionKeydown);
            elements.mentionAllPlays?.addEventListener('click', insertMention);
            elements.anonChange?.addEventListener('click', openAnonNameEditor);
            elements.anonSave?.addEventListener('click', saveAnonName);
            elements.anonCancel?.addEventListener('click', closeAnonNameEditor);
            elements.anonInput?.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    saveAnonName();
                }
                if (event.key === 'Escape') closeAnonNameEditor();
            });
            elements.chatReactionButtons.forEach((button) => {
                button.addEventListener('click', () => void sendChatReaction(button));
            });
            document.addEventListener('click', (event) => {
                if (!elements.mentionMenu || !elements.chatInput) return;
                if (elements.mentionMenu.contains(event.target) || event.target === elements.chatInput) return;
                hideMentionMenu();
            });
            uiState.chatParityBound = true;
        }
        const unsubscribeAuth = authTools.checkAuth((user) => {
            const previousUid = uiState.chatUser?.uid || '';
            const nextUid = user?.uid || '';
            uiState.chatUser = user;
            if (previousUid !== nextUid) uiState.anonName = '';
            if (user) ensureChatDisplayName();
            refreshChatAvailability();
        }, { skipEmailVerificationCheck: true });
        if (typeof unsubscribeAuth === 'function') uiState.unsubscribers.push(unsubscribeAuth);
        refreshChatAvailability();
    } catch (error) {
        console.warn('Overlay chat controls failed to initialize:', error);
        uiState.chatControlsReady = false;
        uiState.chatEnabled = false;
        renderChatComposer();
    }
}

function renderAll() {
    renderScoreboard();
    renderEvents();
    renderLineup();
    renderLeaders();
    renderOpponentStats();
    renderChat();
    renderAnnouncerControls();
}

function resetOverlayFromGame(game = {}, stateTools, message = 'Game reset. Waiting for plays…') {
    const previousClock = captureLiveClockState();
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
    syncLiveClockAnchor(previousClock);
    uiState.latestRenderedEventId = null;
    renderAll();
    const placeholder = elements.eventList.querySelector('.empty-state');
    if (placeholder) placeholder.textContent = message;
}

function processLiveEventSnapshot(events = [], stateTools) {
    const previousClock = captureLiveClockState();
    reconcileOverlayLiveEvents(uiState.game, events, stateTools);
    syncLiveClockAnchor(previousClock);
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
    const historyAvailable = uiState.replayHistoryStatus === 'ready';
    const elapsed = Math.min(duration, Math.max(0, uiState.replayElapsedMs));
    elements.replayCurrent.textContent = formatOverlayClock(elapsed);
    elements.replayDuration.textContent = formatOverlayClock(duration);
    elements.replayCurrent.dateTime = `PT${Math.floor(elapsed / 60000)}M${Math.floor((elapsed % 60000) / 1000)}S`;
    elements.replayDuration.dateTime = `PT${Math.floor(duration / 60000)}M${Math.floor((duration % 60000) / 1000)}S`;
    elements.replayProgress.value = duration > 0 ? String((elapsed / duration) * 100) : '0';
    elements.replayProgress.disabled = duration <= 0 || !historyAvailable;
    elements.replayPlay.disabled = duration <= 0 || !historyAvailable;
    elements.replayRestart.disabled = duration <= 0 || !historyAvailable;
    elements.replayPlay.dataset.replayAction = uiState.replayPlaying ? 'pause' : 'play';
    elements.replayPlay.setAttribute('aria-label', uiState.replayPlaying ? 'Pause replay' : 'Play replay');
    elements.replaySpeeds.forEach((button) => {
        button.setAttribute('aria-pressed', String(Number(button.dataset.replaySpeed) === uiState.replaySpeed));
    });
    const isScanning = uiState.replayPlaying && uiState.replaySpeed > 2;
    const scanLabel = `${uiState.replaySpeed}× game scan`;
    if (elements.replayScanSpeed.textContent !== scanLabel) {
        elements.replayScanSpeed.textContent = scanLabel;
    }
    elements.replayScanStatus.hidden = !isScanning;
}

function sendYouTubeCommand(command, args = []) {
    if (uiState.videoMode !== 'youtube' || !elements.iframe.contentWindow) return;
    elements.iframe.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func: command,
        args
    }), uiState.videoOrigin || 'https://www.youtube.com');
}

function rememberMediaSeek(targetMs) {
    const nowMs = Date.now();
    uiState.recentMediaSeekTargets = uiState.recentMediaSeekTargets
        .filter((seek) => nowMs - seek.atMs <= 1600)
        .concat({ targetMs: Math.max(0, Number(targetMs) || 0), atMs: nowMs })
        .slice(-8);
}

function updateReplayVideoDuration(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs === uiState.videoDurationMs) return;
    uiState.videoDurationMs = durationMs;
    if (!uiState.replaySession) return;
    uiState.replayDurationMs = getOverlayReplayDurationMs({
        ...uiState.replaySession,
        videoDurationMs: uiState.videoDurationMs
    });
    setReplayControlState();
}

function isRecentMediaSeekEcho(mediaElapsedMs) {
    const nowMs = Date.now();
    uiState.recentMediaSeekTargets = uiState.recentMediaSeekTargets
        .filter((seek) => nowMs - seek.atMs <= 1600);
    return uiState.recentMediaSeekTargets.some((seek) =>
        Math.abs(mediaElapsedMs - seek.targetMs) <= 1800
    );
}

function syncReplayFromMediaTime(mediaElapsedMs, stateTools) {
    if (!uiState.isReplay || !uiState.replaySession || !stateTools || !Number.isFinite(mediaElapsedMs)) return;
    if (uiState.replayPlaying && uiState.replaySpeed > 2) return;
    const boundedElapsedMs = Math.min(uiState.replayDurationMs, Math.max(0, mediaElapsedMs));
    if (isRecentMediaSeekEcho(boundedElapsedMs)) return;

    const allowedDriftMs = uiState.replayPlaying ? 1800 : 250;
    if (Math.abs(boundedElapsedMs - uiState.replayElapsedMs) <= allowedDriftMs) return;
    resetReplayToElapsed(boundedElapsedMs, stateTools);
    if (uiState.replayPlaying) {
        uiState.replayStartTime = rebaseReplayStartTimeMs(Date.now(), uiState.replayElapsedMs, uiState.replaySpeed);
    }
}

function resumeReplayFromMedia(stateTools) {
    if (uiState.replayPlaying || uiState.replayDurationMs <= 0 || uiState.replayElapsedMs >= uiState.replayDurationMs) return;
    uiState.replayPlaying = true;
    uiState.replayStartTime = rebaseReplayStartTimeMs(Date.now(), uiState.replayElapsedMs, uiState.replaySpeed);
    setReplayControlState();
    uiState.replayFrame = requestAnimationFrame(() => replayTick(stateTools));
}

function handleYouTubeReplayMessage(event, stateTools) {
    if (!uiState.isReplay || uiState.videoMode !== 'youtube' || event.source !== elements.iframe.contentWindow) return;
    if (uiState.videoOrigin && event.origin !== uiState.videoOrigin) return;
    const telemetry = parseYouTubeReplayTelemetry(event.data);
    if (!telemetry) return;

    updateReplayVideoDuration(telemetry.durationMs);
    syncReplayFromMediaTime(telemetry.currentTimeMs, stateTools);
    if (telemetry.playerState === 2 && uiState.replayPlaying && uiState.replaySpeed <= 2) {
        pauseReplay({ syncMedia: false });
    }
    if (telemetry.playerState === 1 && !uiState.replayPlaying) {
        resumeReplayFromMedia(stateTools);
        if (uiState.replaySpeed > 2) syncReplayMedia({ play: true });
    }
}

function startYouTubeReplayListening() {
    if (!uiState.isReplay || uiState.videoMode !== 'youtube' || !elements.iframe.contentWindow) return;
    elements.iframe.contentWindow.postMessage(JSON.stringify({
        event: 'listening',
        id: elements.iframe.id,
        channel: 'allplays-overlay-replay'
    }), uiState.videoOrigin || 'https://www.youtube.com');
}

async function syncReplayMedia({ seek = false, play = uiState.replayPlaying } = {}) {
    if (!uiState.isReplay) return true;
    const seconds = Math.max(0, uiState.replayElapsedMs / 1000);
    const isScanning = play && uiState.replaySpeed > 2;

    if (uiState.videoMode === 'recorded') {
        if (seek) rememberMediaSeek(uiState.replayElapsedMs);
        if (seek && Number.isFinite(elements.recordedVideo.duration)) {
            elements.recordedVideo.currentTime = Math.min(seconds, elements.recordedVideo.duration);
        } else if (seek) {
            elements.recordedVideo.currentTime = seconds;
        }
        elements.recordedVideo.playbackRate = Math.min(uiState.replaySpeed, 2);
        if (play && !isScanning) {
            try {
                await elements.recordedVideo.play();
                return true;
            } catch (error) {
                console.warn('Recorded replay playback was blocked:', error);
                return false;
            }
        }
        elements.recordedVideo.pause();
        return true;
    }

    if (uiState.videoMode === 'youtube') {
        if (seek) {
            rememberMediaSeek(uiState.replayElapsedMs);
            sendYouTubeCommand('seekTo', [seconds, true]);
        }
        sendYouTubeCommand('setPlaybackRate', [Math.min(uiState.replaySpeed, 2)]);
        sendYouTubeCommand(play && !isScanning ? 'playVideo' : 'pauseVideo');
    }
    return true;
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
    if (eventWindow.events.length) {
        // Snapshot reconciliation intentionally rebuilds canonical score, lineup,
        // plays, and stats. Give it the complete replay window so a later
        // clock-only batch cannot erase previously applied stat events.
        processLiveEventSnapshot(session.replayEvents.slice(0, eventWindow.nextReplayIndex), stateTools);
    }
    session.replayIndex = eventWindow.nextReplayIndex;
    applyReplayStreams(elapsed);
    uiState.replayElapsedMs = elapsed;
    uiState.game.gameClockMs = elapsed;
    renderScoreboard();
    setReplayControlState();
}

function pauseReplay({ syncMedia = true } = {}) {
    const wasScanning = uiState.replayPlaying && uiState.replaySpeed > 2;
    uiState.replayPlaying = false;
    if (uiState.replayFrame !== null) cancelAnimationFrame(uiState.replayFrame);
    uiState.replayFrame = null;
    if (syncMedia) syncReplayMedia({ seek: wasScanning, play: false });
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

async function playReplay(stateTools) {
    if (uiState.replayDurationMs <= 0 || uiState.replayHistoryStatus === 'failed') return;
    if (uiState.replayElapsedMs >= uiState.replayDurationMs) {
        resetReplayToElapsed(0, stateTools);
    }
    const waitsForYouTube = uiState.videoMode === 'youtube' && uiState.replaySpeed <= 2;
    const mediaStarted = await syncReplayMedia({ seek: true, play: true });
    if (!mediaStarted) {
        pauseReplay({ syncMedia: false });
        setConnectionIssue('replayPlayback', 'Video playback was blocked. Press play again or allow media playback in this browser.');
        return;
    }
    setConnectionIssue('replayPlayback');
    // YouTube confirms playback asynchronously through player telemetry. Do
    // not advance the score/event timeline until the video actually starts.
    if (waitsForYouTube) return;
    resumeReplayFromMedia(stateTools);
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
        else void playReplay(stateTools);
    };
    elements.replayRestart.onclick = () => {
        seekReplay(0, stateTools);
        void playReplay(stateTools);
    };
    elements.replayProgress.oninput = (event) => {
        const ratio = Math.min(1, Math.max(0, Number(event.target.value) / 100));
        seekReplay(uiState.replayDurationMs * ratio, stateTools);
    };
    elements.replaySpeeds.forEach((button) => {
        button.onclick = () => {
            const speed = Number(button.dataset.replaySpeed);
            if (!Number.isFinite(speed) || speed <= 0) return;
            const previousSpeed = uiState.replaySpeed;
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
            syncReplayMedia({
                seek: uiState.replayPlaying && previousSpeed > 2 && speed <= 2
            });
            if (speed > 2) {
                elements.screenReaderUpdate.textContent = `${speed} times game scan. Video will catch up when paused.`;
            }
            setReplayControlState();
        };
    });
}

async function loadReplaySnapshot(database, stateTools, teamId, gameId) {
    uiState.isReplay = true;
    uiState.replayStateTools = stateTools;
    uiState.game.liveStatus = 'replay';
    elements.body.dataset.replay = 'true';
    renderPanelVisibility();
    elements.replayControls.hidden = false;
    setConnectionMessage('Loading replay timeline…', 'info');
    const [eventsResult, chatResult, reactionsResult] = await Promise.all([
        loadWithBoundedRetry(() => database.getLiveEvents(teamId, gameId)),
        loadWithBoundedRetry(() => database.getLiveChatHistory(teamId, gameId)),
        typeof database.getLiveReactions === 'function'
            ? loadWithBoundedRetry(() => database.getLiveReactions(teamId, gameId))
            : Promise.resolve({ ok: true, value: [], attempts: 0 })
    ]);

    uiState.replayHistoryStatus = eventsResult.ok ? 'ready' : 'failed';

    const replaySession = buildReplaySessionState({
        teamId,
        gameId,
        game: uiState.game.game,
        defaultPeriod: getDefaultLivePeriod({ game: uiState.game.game, team: uiState.game.team }),
        replayEvents: eventsResult.ok ? eventsResult.value : [],
        replayChat: chatResult.ok ? chatResult.value : [],
        replayReactions: reactionsResult.ok ? reactionsResult.value : []
    });
    replaySession.replayStartAt = getOverlayReplayStartAt({
        replayEvents: replaySession.replayEvents,
        replayChat: replaySession.replayChat,
        replayReactions: replaySession.replayReactions,
        fallbackStartAt: replaySession.replayStartAt
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

    const failedResults = [eventsResult, chatResult, reactionsResult].filter((result) => !result.ok);
    setConnectionMessage('');
    if (failedResults.length) {
        console.warn('Some overlay replay history could not be loaded:', failedResults[0].error);
        const message = !eventsResult.ok
            ? 'Replay timeline is temporarily unavailable after two attempts. The saved video and final score remain available; refresh to retry.'
            : 'Some replay context could not load after two attempts. The saved video and event timeline still work; refresh to retry.';
        setConnectionIssue('replay', message);
    } else {
        setConnectionIssue('replay');
    }
    await syncReplayMedia({ seek: true, play: false });
}

async function loadWithBoundedRetry(loader, attempts = 2) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return { ok: true, value: await loader(), attempts: attempt };
        } catch (error) {
            lastError = error;
        }
    }
    return { ok: false, error: lastError, attempts };
}

function resetVideoElements() {
    elements.iframe.hidden = true;
    elements.iframe.removeAttribute('src');
    elements.recordedVideo.hidden = true;
    elements.recordedVideo.pause();
    elements.recordedVideo.removeAttribute('src');
    elements.recordedVideo.load();
    elements.replayAccessGate.hidden = true;
    setProviderLink('');
    uiState.videoMode = 'none';
    uiState.videoOrigin = '';
    uiState.videoMuted = true;
    updateMuteControl();
}

function showVideoFallback(message = 'The scoreboard and live context stay ready while video connects.') {
    resetVideoElements();
    elements.videoFallbackCopy.textContent = message;
    elements.videoFallback.hidden = false;
}

function showReplayAccessGate({ state = 'checking' } = {}) {
    resetVideoElements();
    elements.videoFallback.hidden = true;
    const presentations = {
        checking: {
            kicker: 'Checking access',
            title: 'Checking replay access…',
            copy: 'The scoreboard and saved game timeline remain available while replay access is verified.'
        },
        locked: {
            kicker: 'Team Pass required',
            title: 'Archived replay video is locked',
            copy: 'This premium fan feature unlocks when the team has an active paid Team Pass for the season. Ask a coach or team admin to activate access.'
        },
        unavailable: {
            kicker: 'Access check delayed',
            title: 'Replay access could not be verified',
            copy: 'The video stays protected while access is unavailable. Refresh to try again; scores, plays, and saved chat remain available.'
        }
    };
    const presentation = presentations[state] || presentations.unavailable;
    elements.replayAccessKicker.textContent = presentation.kicker;
    elements.replayAccessTitle.textContent = presentation.title;
    elements.replayAccessCopy.textContent = presentation.copy;
    elements.replayAccessGate.hidden = false;
}

function showEmbedVideo(sourceUrl, publicUrl = '', { controllableReplay = false, publicLabel = 'Open video ↗' } = {}) {
    const effectiveSourceUrl = controllableReplay
        ? getControllableReplayEmbedUrl(sourceUrl, window.location.origin)
        : getControllableYouTubeEmbedUrl(sourceUrl, window.location.origin);
    if (!elements.iframe.hidden && elements.iframe.getAttribute('src') === effectiveSourceUrl) {
        setProviderLink(publicUrl, publicLabel);
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
        uiState.videoMuted = isYouTube ? source.searchParams.get('mute') === '1' : true;
    } catch {
        uiState.videoMode = 'embed';
        uiState.videoMuted = true;
    }
    setProviderLink(publicUrl, publicLabel);
    updateMuteControl();
}

function showRecordedVideo(sourceUrl, publicUrl = '', publicLabel = 'Open replay video ↗') {
    if (!elements.recordedVideo.hidden && elements.recordedVideo.getAttribute('src') === sourceUrl) {
        setProviderLink(publicUrl, publicLabel);
        if (uiState.isReplay && uiState.replaySession) {
            syncReplayMedia({ seek: true, play: uiState.replayPlaying });
        }
        return;
    }
    resetVideoElements();
    elements.videoFallback.hidden = true;
    elements.recordedVideo.src = sourceUrl;
    elements.recordedVideo.hidden = false;
    uiState.videoMode = 'recorded';
    uiState.videoMuted = elements.recordedVideo.muted;
    setProviderLink(publicUrl, publicLabel);
    updateMuteControl();
}

function getDemoVideoId(params) {
    const candidate = String(params.videoId || '').trim();
    return /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : 'PK1HyC37doc';
}

function renderPanelVisibility() {
    const compact = usesCompactPanelLayout();
    if (compact) {
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

    elements.body.dataset.panelLayout = compact ? 'compact' : 'wide';
    elements.body.dataset.panelOpen = String(compact && uiState.activeMobilePanel !== null);

    elements.panelToggles.forEach((button) => {
        const panel = button.dataset.panel;
        let pressed = false;
        if (panel === 'plays') pressed = compact ? uiState.activeMobilePanel === 'plays' : uiState.desktopPanels.plays;
        if (panel === 'insights') pressed = compact ? uiState.activeMobilePanel === 'insights' && uiState.activeInsight !== 'chat' : uiState.desktopPanels.insights && uiState.activeInsight !== 'chat';
        if (panel === 'chat') pressed = compact ? uiState.activeMobilePanel === 'insights' && uiState.activeInsight === 'chat' : uiState.desktopPanels.insights && uiState.activeInsight === 'chat';
        button.setAttribute('aria-pressed', String(pressed));
        button.setAttribute('aria-expanded', String(pressed));
    });
}

function selectInsight(name) {
    uiState.activeInsight = name;
    if (name === 'chat' && !usesCompactPanelLayout()) markChatSeen();
    elements.insightTabs.forEach((tab) => {
        tab.setAttribute('aria-selected', String(tab.id === `${name}-tab`));
    });
    elements.insightViews.forEach((view) => {
        view.hidden = view.id !== `${name}-view`;
    });
    renderPanelVisibility();
}

function togglePanel(panel) {
    const compact = usesCompactPanelLayout();
    if (panel === 'chat') {
        const wasActive = compact && uiState.activeMobilePanel === 'insights' && uiState.activeInsight === 'chat';
        selectInsight('chat');
        if (compact) uiState.activeMobilePanel = wasActive ? null : 'insights';
        else uiState.desktopPanels.insights = true;
        if (!wasActive) markChatSeen();
    } else if (panel === 'insights') {
        if (uiState.activeInsight === 'chat') selectInsight('lineup');
        if (compact) uiState.activeMobilePanel = uiState.activeMobilePanel === 'insights' ? null : 'insights';
        else uiState.desktopPanels.insights = !uiState.desktopPanels.insights;
    } else if (panel === 'plays') {
        if (compact) uiState.activeMobilePanel = uiState.activeMobilePanel === 'plays' ? null : 'plays';
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

function startDisplayClock() {
    window.clearInterval(uiState.clockTimer);
    uiState.clockTimer = window.setInterval(() => {
        if (!uiState.game) return;
        if (uiState.isDemo) {
            if (!uiState.clockRunning || uiState.game.gameClockMs <= 0) return;
            uiState.game.gameClockMs = Math.max(0, uiState.game.gameClockMs - 1000);
        } else if (uiState.isReplay || uiState.game.clockRunning !== true || isCompletedGame()) {
            return;
        }
        renderScoreboard();
    }, 250);
}

async function startDemoReplayMode(params) {
    const fixture = createOverlayDemoFixture();
    const replayStartAt = 1_000_000;
    fixture.game = {
        ...fixture.game,
        homeScore: 2,
        awayScore: 1,
        period: 'H2',
        liveClockMs: 15_000,
        liveStatus: 'completed',
        status: 'completed'
    };
    const replayEvents = [
        { id: 'demo-replay-start', type: 'clock_sync', homeScore: 0, awayScore: 0, period: 'H1', gameClockMs: 0, createdAt: replayStartAt },
        { id: 'demo-replay-lineup', type: 'lineup', onCourt: ['p11', 'p7', 'p4', 'p1'], bench: ['p9', 'p18'], period: 'H1', gameClockMs: 1_000, createdAt: replayStartAt + 1_000 },
        { id: 'demo-replay-goal-1', type: 'goal', description: 'Kurtz opens the scoring from the top of the box', playerId: 'p11', playerName: 'Bennett Kurtz', playerNumber: '11', statKey: 'goals', value: 1, homeScore: 1, awayScore: 0, period: 'H1', gameClockMs: 3_000, createdAt: replayStartAt + 3_000 },
        { id: 'demo-replay-away', type: 'goal', description: 'Union KC equalizes from the penalty spot', playerId: 'opponent', isOpponent: true, statKey: 'goals', value: 1, homeScore: 1, awayScore: 1, period: 'H2', gameClockMs: 7_000, createdAt: replayStartAt + 7_000 },
        { id: 'demo-replay-goal-2', type: 'goal', description: 'Persell finds the winner on the counterattack', playerId: 'p7', playerName: 'Dominic Persell', playerNumber: '7', statKey: 'goals', value: 1, homeScore: 2, awayScore: 1, period: 'H2', gameClockMs: 12_000, createdAt: replayStartAt + 12_000 },
        { id: 'demo-replay-final', type: 'clock_sync', homeScore: 2, awayScore: 1, period: 'H2', gameClockMs: 15_000, createdAt: replayStartAt + 15_000 }
    ];
    const replayChat = [
        { id: 'demo-replay-chat-1', senderName: 'Soccer Dad', text: 'What a finish!', createdAt: replayStartAt + 4_000 },
        { id: 'demo-replay-chat-2', senderName: 'Coach Sarah', text: 'Great recovery shape in the second half.', createdAt: replayStartAt + 10_000 }
    ];
    const replayReactions = [
        { id: 'demo-replay-reaction-1', type: 'clap', createdAt: replayStartAt + 3_500 },
        { id: 'demo-replay-reaction-2', type: 'heart', createdAt: replayStartAt + 12_500 }
    ];

    uiState.isDemo = true;
    uiState.isReplay = true;
    uiState.game = createOverlayState({ team: fixture.team, game: fixture.game, players: fixture.players });
    uiState.game.stats = {};
    renderAll();
    const videoId = getDemoVideoId(params);
    showEmbedVideo(
        `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1`,
        `https://www.youtube.com/watch?v=${videoId}`,
        { controllableReplay: true }
    );
    uiState.videoDurationMs = 15_000;
    const stateTools = await import('./live-game-state.js?v=37');
    await loadReplaySnapshot({
        getLiveEvents: async () => replayEvents,
        getLiveChatHistory: async () => replayChat,
        getLiveReactions: async () => replayReactions
    }, stateTools, fixture.team.id, fixture.game.id);
}

function bindInteractions() {
    elements.panelToggles.forEach((button) => button.addEventListener('click', () => togglePanel(button.dataset.panel)));
    elements.insightTabs.forEach((tab) => tab.addEventListener('click', () => selectInsight(tab.id.replace('-tab', ''))));
    elements.focusToggle.addEventListener('click', toggleFocusMode);
    elements.shareGame.addEventListener('click', () => void shareGame());
    elements.shareGameMenu.addEventListener('click', () => void shareGame());
    elements.scoreboardToggle.addEventListener('click', () => toggleScoreboardVisibility());
    elements.scoreboardMenuToggle.addEventListener('click', () => toggleScoreboardVisibility({ closeMenu: true }));
    elements.muteToggle.addEventListener('click', toggleVideoMute);
    elements.fullscreenToggle.addEventListener('click', () => void toggleFullscreen());
    elements.gameActionsToggle.addEventListener('click', toggleGameActionsMenu);
    elements.gameActionsMenu.addEventListener('click', (event) => {
        if (event.target.closest('a')) closeGameActionsMenu();
    });
    elements.gameActionsMenu.addEventListener('keydown', (event) => {
        const items = [...elements.gameActionsMenu.querySelectorAll('[role^="menuitem"]')]
            .filter((item) => !item.hidden);
        const currentIndex = items.indexOf(document.activeElement);
        let nextIndex = null;
        if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
        if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = items.length - 1;
        if (nextIndex === null || !items.length) return;
        event.preventDefault();
        items[nextIndex].focus();
    });
    elements.announcerToggle.addEventListener('click', () => {
        playAnnouncer.setEnabled(!playAnnouncer.isEnabled());
        renderAnnouncerControls();
    });
    elements.announcerPause.addEventListener('click', () => {
        playAnnouncer.setPaused(!playAnnouncer.isPaused());
        renderAnnouncerControls();
    });
    elements.demoLabToggle.addEventListener('click', () => setDemoLabOpen(elements.demoLab.hidden));
    elements.demoLabClose.addEventListener('click', () => setDemoLabOpen(false));
    elements.demoActions.forEach((button) => button.addEventListener('click', () => handleDemoAction(button.dataset.action)));
    elements.iframe.addEventListener('load', () => {
        window.setTimeout(() => {
            if (uiState.videoMode === 'youtube') sendYouTubeCommand(uiState.videoMuted ? 'mute' : 'unMute');
            if (!uiState.isReplay) return;
            startYouTubeReplayListening();
            syncReplayMedia({ seek: true });
        }, 0);
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
            syncReplayMedia({ seek: true, play: uiState.replayPlaying });
        }
    });
    elements.recordedVideo.addEventListener('timeupdate', () => {
        if (!uiState.isReplay) return;
        syncReplayFromMediaTime(elements.recordedVideo.currentTime * 1000, uiState.replayStateTools);
    });
    elements.recordedVideo.addEventListener('play', () => {
        if (!uiState.isReplay) return;
        resumeReplayFromMedia(uiState.replayStateTools);
        if (uiState.replaySpeed > 2) syncReplayMedia({ play: true });
    });
    elements.recordedVideo.addEventListener('pause', () => {
        if (!uiState.isReplay || !uiState.replayPlaying || uiState.replaySpeed > 2) return;
        pauseReplay({ syncMedia: false });
    });
    window.addEventListener('message', (event) => {
        if (!uiState.replayStateTools) return;
        handleYouTubeReplayMessage(event, uiState.replayStateTools);
    });
    document.addEventListener('fullscreenchange', updateFullscreenControl);
    document.addEventListener('click', (event) => {
        if (elements.gameActionsMenu.hidden) return;
        if (elements.gameActionsMenu.contains(event.target) || elements.gameActionsToggle.contains(event.target)) return;
        closeGameActionsMenu();
    });
    window.addEventListener('resize', renderPanelVisibility);
    window.addEventListener('keydown', (event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        if (event.key === 'Escape') {
            setDemoLabOpen(false);
            closeGameActionsMenu({ restoreFocus: !elements.gameActionsMenu.hidden });
            if (usesCompactPanelLayout()) uiState.activeMobilePanel = null;
            renderPanelVisibility();
            return;
        }
        if (event.key.toLowerCase() === 'p') togglePanel('plays');
        if (event.key.toLowerCase() === 'i') togglePanel('insights');
        if (event.key.toLowerCase() === 'c') togglePanel('chat');
        if (event.key.toLowerCase() === 'm') toggleVideoMute();
        if (event.key.toLowerCase() === 's') toggleScoreboardVisibility();
        if (event.key.toLowerCase() === 'f' && event.shiftKey) void toggleFullscreen();
        else if (event.key.toLowerCase() === 'f') toggleFocusMode();
    });
    window.addEventListener('beforeunload', () => {
        window.clearInterval(uiState.clockTimer);
        if (uiState.replayFrame !== null) cancelAnimationFrame(uiState.replayFrame);
        uiState.unsubscribers.forEach((unsubscribe) => {
            try { unsubscribe(); } catch { /* no-op */ }
        });
    });
}

async function startDemoMode(params) {
    if (params.replay === 'true') {
        await startDemoReplayMode(params);
        return;
    }
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
}

async function startRealMode(params) {
    const teamId = String(params.teamId || '').trim();
    const gameId = String(params.gameId || '').trim();
    if (!isValidDocumentId(teamId) || !isValidDocumentId(gameId)) {
        showVideoFallback('Add valid teamId and gameId values to load a real game, or add ?demo=1 to explore the preview.');
        setConnectionMessage('This broadcast view needs a teamId and gameId. Add ?demo=1 for the interactive local demo.');
        setStatus('scheduled');
        return;
    }

    uiState.teamId = teamId;
    uiState.gameId = gameId;
    configureGameActions();

    setConnectionMessage('Connecting to the game, event feed, and chat…', 'info');
    try {
        const [database, videoTools, stateTools] = await Promise.all([
            loadOverlayDatabase(),
            import('./live-game-video.js?v=443315'),
            import('./live-game-state.js?v=37')
        ]);
        uiState.optionalTeamStatus = 'pending';
        const teamPromise = loadWithBoundedRetry(
            () => database.getGameDayTeamContext(teamId, gameId, { includeInactive: true })
        ).then((result) => {
            if (result.ok) {
                uiState.optionalTeamStatus = 'ready';
                setConnectionIssue('team');
                return result.value || {};
            }
            console.warn('Overlay team context could not be loaded:', result.error);
            uiState.optionalTeamStatus = 'failed';
            setConnectionIssue('team', 'Team stream and replay settings are temporarily unavailable after two attempts. Score, clock, plays, and chat remain connected; refresh to retry.');
            return {};
        });
        uiState.optionalPlayersStatus = 'pending';
        const playersPromise = loadWithBoundedRetry(
            () => database.getPlayers(teamId, { includeInactive: true })
        );
        const game = await database.getGame(teamId, gameId);
        if (!game) throw new Error('Game not found.');

        // A public game projection is sufficient to start the broadcast. Team
        // and roster reads are optional enrichment and can be slower for some
        // signed-in access paths, so they must never delay live subscriptions.
        let resolvedTeam = {};
        let resolvedPlayers = [];
        uiState.game = createOverlayState({ team: resolvedTeam, game, players: resolvedPlayers });
        // The canonical viewer derives home-player stats from the ordered event
        // stream. Keep the demo fixture's seeded stats, but avoid double-counting
        // persisted liveStats when the initial live snapshot arrives.
        uiState.game.stats = {};
        const isReplay = params.replay === 'true';
        uiState.isReplay = isReplay;
        syncLiveClockAnchor();
        configureGameActions();
        elements.body.dataset.replay = String(isReplay);
        renderPanelVisibility();
        if (isReplay) uiState.game.liveStatus = 'replay';
        renderAll();
        renderChatComposer();
        const renderVideoSafely = async () => {
            const requestId = ++uiState.videoRequestId;
            try {
                const options = videoTools.resolveReplayVideoOptions({
                    team: uiState.game.team,
                    game: uiState.game.game,
                    players: uiState.game.players,
                    isReplay
                });
                uiState.videoDurationMs = Number.isFinite(options.durationMs) ? options.durationMs : 0;
                if (isReplay && options.mode === 'recorded' && options.sourceUrl) {
                    if (uiState.optionalTeamStatus === 'pending') {
                        showReplayAccessGate({ state: 'checking' });
                        return true;
                    }
                    if (uiState.optionalTeamStatus === 'failed') {
                        showReplayAccessGate({ state: 'unavailable' });
                        return true;
                    }
                    const entitlements = await import('./team-entitlements.js?v=9');
                    if (requestId !== uiState.videoRequestId) return false;
                    const gateEnabled = entitlements.isRecordedReplayTeamPassGateEnabled({
                        game: uiState.game.game,
                        team: uiState.game.team
                    });
                    if (gateEnabled) {
                        const seasonId = entitlements.resolveTeamEntitlementSeasonId({
                            game: uiState.game.game,
                            team: uiState.game.team
                        });
                        const entitlementKey = `${teamId}:${seasonId}`;
                        if (uiState.teamEntitlementKey !== entitlementKey) {
                            uiState.teamEntitlementKey = entitlementKey;
                            uiState.teamEntitlement = null;
                            uiState.teamEntitlementPromise = entitlements.getTeamEntitlementStatus({ teamId, seasonId })
                                .then((status) => {
                                    uiState.teamEntitlement = status;
                                    return status;
                                });
                        }
                        const entitlementStatus = uiState.teamEntitlement || await uiState.teamEntitlementPromise;
                        if (requestId !== uiState.videoRequestId) return false;
                        const videoUnlocked = entitlements.canAccessPremiumFanFeature(
                            entitlements.TEAM_PASS_FEATURES.RECORDED_REPLAY,
                            entitlementStatus
                        );
                        if (!videoUnlocked) {
                            showReplayAccessGate({
                                state: entitlementStatus?.access?.state === 'unavailable' ? 'unavailable' : 'locked'
                            });
                            return true;
                        }
                    }
                }
                if (options.mode === 'embed' && options.sourceUrl) {
                    showEmbedVideo(options.sourceUrl, options.publicUrl, {
                        controllableReplay: isReplay,
                        publicLabel: options.publicLabel
                    });
                }
                else if (options.mode === 'recorded' && options.sourceUrl) {
                    showRecordedVideo(options.sourceUrl, options.publicUrl, options.publicLabel);
                }
                else showVideoFallback(options.replayState?.message || 'No video feed is configured for this game yet.');
                return true;
            } catch (error) {
                console.warn('Overlay video refresh failed:', error);
                if (elements.iframe.hidden && elements.recordedVideo.hidden) {
                    showVideoFallback('The video feed is temporarily unavailable. Live score and play updates remain connected.');
                }
                setConnectionIssue('video', 'Video refresh is delayed. Score, clock, plays, and chat continue independently.');
                return false;
            }
        };
        void renderVideoSafely().then((success) => {
            if (success) setConnectionIssue('video');
        });

        const refreshOptionalContext = () => {
            if (!uiState.game) return;
            const context = createOverlayState({
                team: resolvedTeam,
                game: uiState.game.game,
                players: resolvedPlayers
            });
            uiState.game.team = context.team;
            uiState.game.players = context.players;
            uiState.game.playerMap = context.playerMap;
            uiState.game.homeName = context.homeName;
            uiState.game.awayName = context.awayName;
            if (!uiState.game.sport) uiState.game.sport = context.sport;
            if (!uiState.game.periods && context.periods) uiState.game.periods = context.periods;
            renderScoreboard();
            renderLineup();
            renderLeaders();
            renderOpponentStats();
            void renderVideoSafely();
        };
        void teamPromise.then((team) => {
            resolvedTeam = team || {};
            refreshOptionalContext();
        });
        void playersPromise.then((result) => {
            if (!result.ok) {
                uiState.optionalPlayersStatus = 'failed';
                console.warn('Overlay roster context could not be loaded:', result.error);
                setConnectionIssue('players', 'Roster details are temporarily unavailable after two attempts. Live lineup positions remain connected; refresh to retry.');
                renderLineup();
                return;
            }
            uiState.optionalPlayersStatus = 'ready';
            resolvedPlayers = Array.isArray(result.value) ? result.value : [];
            setConnectionIssue('players');
            refreshOptionalContext();
        });

        if (isReplay) {
            await loadReplaySnapshot(database, stateTools, teamId, gameId);
            return;
        }

        uiState.unsubscribers.push(database.subscribeGame(teamId, gameId, (updatedGame) => {
            if (!updatedGame) return;
            try {
                const previousClock = captureLiveClockState();
                const resetAt = getTimestampMs(updatedGame.liveResetAt);
                const crossedResetBoundary = resetAt > (uiState.game.lastResetAt || 0);
                if (crossedResetBoundary) uiState.game.lastResetAt = resetAt;
                const hasEventAuthority = uiState.hasLiveEventSnapshot && uiState.lastLiveEvents.length > 0;
                applyOverlayGame(uiState.game, updatedGame, {
                    preserveEventState: hasEventAuthority && !crossedResetBoundary
                });
                syncLiveClockAnchor(previousClock);
                configureGameActions();
                if (crossedResetBoundary && uiState.hasLiveEventSnapshot) {
                    processLiveEventSnapshot(uiState.lastLiveEvents, stateTools);
                } else if (hasEventAuthority) {
                    // The event listener already owns score, clock, period,
                    // lineup, and stats. Rendering the safe game-document fields
                    // directly avoids rebuilding event state from a stale public
                    // projection poll.
                    renderAll();
                } else if (uiState.hasLiveEventSnapshot) {
                    processLiveEventSnapshot(uiState.lastLiveEvents, stateTools);
                } else if (crossedResetBoundary || stateTools.shouldResetViewerFromGameDoc(updatedGame, uiState.game)) {
                    resetOverlayFromGame(updatedGame, stateTools);
                } else {
                    renderAll();
                }
                refreshChatAvailability();
                void renderVideoSafely().then((success) => {
                    if (success) setConnectionIssue('video');
                });
                setConnectionIssue('game');
            } catch (error) {
                console.warn('Overlay game update could not be applied:', error);
                setConnectionIssue('game', 'A score refresh was skipped. Existing video, score, and play data remain available.');
            }
        }, (error) => {
            console.warn('Overlay game subscription failed:', error);
            setConnectionIssue('game', 'Live score refresh is delayed. The video remains available; try refreshing if it does not recover.');
        }, { publicProjection: game.isPublicProjection === true }));

        uiState.unsubscribers.push(database.subscribeLiveEvents(teamId, gameId, (events) => {
            try {
                uiState.lastLiveEvents = Array.isArray(events) ? [...events] : [];
                uiState.hasLiveEventSnapshot = true;
                processLiveEventSnapshot(uiState.lastLiveEvents, stateTools);
                setConnectionIssue('events');
            } catch (error) {
                console.warn('Overlay event update could not be applied:', error);
                setConnectionIssue('events', 'One play update was skipped. Video, scoreboard refresh, and chat continue independently.');
            }
        }, (error) => {
            console.warn('Overlay event subscription failed:', error);
            setConnectionIssue('events', 'Play-by-play is temporarily unavailable. Video and scoreboard updates continue independently.');
        }));

        uiState.unsubscribers.push(database.subscribeLiveChat(teamId, gameId, { limit: 100 }, (messages) => {
            replaceOverlayChat(uiState.game, messages);
            renderChat();
            setConnectionIssue('chat');
        }, (error) => {
            console.warn('Overlay chat subscription failed:', error);
            setConnectionIssue('chat', 'Live chat is temporarily unavailable. Video, score, and play updates continue independently.');
        }));

        uiState.unsubscribers.push(database.subscribeReactions(teamId, gameId, (reaction) => {
            showFloatingReaction(reaction);
            setConnectionIssue('reactions');
        }, (error) => {
            console.warn('Overlay reaction subscription failed:', error);
            setConnectionIssue('reactions', 'Live reactions are temporarily unavailable. The rest of the broadcast continues.');
        }));

        void initializeChatComposer(database, teamId, gameId);
        setConnectionMessage('');
    } catch (error) {
        console.warn('Overlay broadcast failed to connect:', error);
        showVideoFallback('The game could not be loaded. The interactive preview remains available.');
        setConnectionMessage(`Could not load this game. Open ${window.location.pathname}?demo=1 to use the interactive preview.`);
        setStatus('scheduled');
    }
}

async function init() {
    bindInteractions();
    updateScoreboardVisibility();
    renderPanelVisibility();
    const params = getQueryParams();
    if (params.demo === '1' || params.demo === 'true') await startDemoMode(params);
    else await startRealMode(params);
    startDisplayClock();
}

init().catch((error) => {
    console.error('Overlay broadcast failed to start:', error);
    showVideoFallback('The overlay broadcast could not start. Refresh the page to try again.');
    setConnectionMessage('The overlay broadcast could not start. Refresh the page to try again.');
});
