import {
    applyOverlayEvents,
    applyOverlayGame,
    createOverlayDemoFixture,
    createOverlayState,
    formatOverlayClock,
    getOverlayLineup,
    replaceOverlayChat
} from './live-game-overlay-model.js?v=1';

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
    connectionMessage: document.querySelector('#connection-message'),
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
        elements.eventList.appendChild(createTextElement('li', 'empty-state', 'Connected. Waiting for the first play…'));
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
        elements.chatList.appendChild(createTextElement('li', 'empty-state', 'Live chat is quiet right now.'));
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

function resetVideoElements() {
    elements.iframe.hidden = true;
    elements.iframe.removeAttribute('src');
    elements.recordedVideo.hidden = true;
    elements.recordedVideo.pause();
    elements.recordedVideo.removeAttribute('src');
    elements.recordedVideo.load();
    elements.openStream.hidden = true;
    elements.openStream.removeAttribute('href');
}

function showVideoFallback(message = 'The scoreboard and live context stay ready while video connects.') {
    resetVideoElements();
    elements.videoFallbackCopy.textContent = message;
    elements.videoFallback.hidden = false;
}

function showEmbedVideo(sourceUrl, publicUrl = '') {
    if (!elements.iframe.hidden && elements.iframe.getAttribute('src') === sourceUrl) {
        if (publicUrl) {
            elements.openStream.href = publicUrl;
            elements.openStream.hidden = false;
        }
        return;
    }
    resetVideoElements();
    elements.videoFallback.hidden = true;
    elements.iframe.src = sourceUrl;
    elements.iframe.hidden = false;
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
        setConnectionMessage('This prototype needs a teamId and gameId. Add ?demo=1 for the interactive local demo.');
        setStatus('scheduled');
        return;
    }

    setConnectionMessage('Connecting to the game, event feed, and chat…', 'info');
    try {
        const [database, videoTools] = await Promise.all([
            import('./db.js?v=4433176'),
            import('./live-game-video.js?v=443315')
        ]);
        const teamPromise = database.getGameDayTeamContext(teamId, gameId, { includeInactive: true }).catch(() => ({}));
        const playersPromise = database.getPlayers(teamId, { includeInactive: true }).catch(() => []);
        const [team, game, players] = await Promise.all([teamPromise, database.getGame(teamId, gameId), playersPromise]);
        if (!game) throw new Error('Game not found.');

        uiState.game = createOverlayState({ team: team || {}, game, players });
        renderAll();
        const renderVideo = () => {
            const options = videoTools.resolveReplayVideoOptions({
                team: uiState.game.team,
                game: uiState.game.game,
                players: uiState.game.players,
                isReplay: params.replay === 'true'
            });
            if (options.mode === 'embed' && options.sourceUrl) showEmbedVideo(options.sourceUrl, options.publicUrl);
            else if (options.mode === 'recorded' && options.sourceUrl) showRecordedVideo(options.sourceUrl, options.publicUrl);
            else showVideoFallback(options.replayState?.message || 'No video feed is configured for this game yet.');
        };
        renderVideo();
        setConnectionMessage('');

        uiState.unsubscribers.push(database.subscribeGame(teamId, gameId, (updatedGame) => {
            if (!updatedGame) return;
            applyOverlayGame(uiState.game, updatedGame);
            renderAll();
            renderVideo();
        }, (error) => {
            console.warn('Overlay game subscription failed:', error);
            setConnectionMessage('Live score refresh is delayed. The video remains available; try refreshing if it does not recover.');
        }, { publicProjection: game.isPublicProjection === true }));

        uiState.unsubscribers.push(database.subscribeLiveEvents(teamId, gameId, (events) => {
            applyOverlayEvents(uiState.game, events);
            renderAll();
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
    } catch (error) {
        console.warn('Overlay prototype failed to connect:', error);
        showVideoFallback('The real game could not be loaded in this local environment. Demo mode remains available.');
        setConnectionMessage(`Could not load this game here. Open ${window.location.pathname}?demo=1 to use the interactive local prototype.`);
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
    console.error('Overlay prototype failed to start:', error);
    showVideoFallback('The overlay prototype could not start. Refresh the page to try again.');
    setConnectionMessage('The overlay prototype could not start. Refresh the page to try again.');
});
