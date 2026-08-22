const DEFAULT_PERIOD = 'H1';

function toFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function toText(value, fallback = '') {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || fallback;
}

function getTimestampMs(value) {
    if (Number.isFinite(value)) return Number(value);
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value && typeof value.toDate === 'function') return value.toDate().getTime();
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function sortNewestFirst(items = []) {
    return [...items].sort((left, right) => {
        const leftTime = getTimestampMs(left.createdAt || left.timestamp);
        const rightTime = getTimestampMs(right.createdAt || right.timestamp);
        return rightTime - leftTime;
    });
}

export function formatOverlayClock(milliseconds = 0) {
    const totalSeconds = Math.max(0, Math.floor(toFiniteNumber(milliseconds) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function getOverlayEventTone(event = {}) {
    const type = toText(event.type).toLowerCase();
    const statKey = toText(event.statKey).toLowerCase();
    if (type === 'reset' || ['clock_pause', 'clock_start', 'clock_sync', 'period_change'].includes(type)) {
        return 'system';
    }
    if (type === 'goal' || type === 'football_score' || type === 'score_update' || ['pts', 'points', 'goals'].includes(statKey)) {
        return event.isOpponent ? 'away-score' : 'home-score';
    }
    return event.isOpponent ? 'away' : 'home';
}

export function normalizeOverlayEvent(event = {}, index = 0) {
    const tone = getOverlayEventTone(event);
    const isScore = tone === 'home-score' || tone === 'away-score';
    const description = toText(event.description, isScore ? 'Score recorded' : 'Game update');
    return {
        ...event,
        id: toText(event.id, `event-${index}-${getTimestampMs(event.createdAt || event.timestamp)}`),
        description,
        period: toText(event.period, DEFAULT_PERIOD),
        gameClockMs: Math.max(0, toFiniteNumber(event.gameClockMs)),
        tone,
        label: isScore ? (toText(event.statKey).toLowerCase() === 'goals' || event.type === 'goal' ? 'GOAL' : 'SCORE') : '',
        createdAtMs: getTimestampMs(event.createdAt || event.timestamp)
    };
}

function normalizePlayer(player = {}, index = 0) {
    return {
        ...player,
        id: toText(player.id || player.playerId, `player-${index}`),
        name: toText(player.name || player.displayName || player.playerName, 'Player'),
        number: toText(player.number || player.jerseyNumber),
        position: toText(player.position || player.role)
    };
}

function normalizeChatMessage(message = {}, index = 0) {
    return {
        ...message,
        id: toText(message.id, `message-${index}-${getTimestampMs(message.createdAt)}`),
        senderName: toText(message.senderName || message.name, message.ai ? 'ALL PLAYS' : 'Fan'),
        text: toText(message.text || message.message, ''),
        createdAtMs: getTimestampMs(message.createdAt)
    };
}

export function createOverlayState({ team = {}, game = {}, players = [], events = [], chatMessages = [] } = {}) {
    const normalizedPlayers = players.map(normalizePlayer);
    const normalizedEvents = sortNewestFirst(events.map(normalizeOverlayEvent));
    const normalizedChat = sortNewestFirst(chatMessages.map(normalizeChatMessage));
    return {
        team,
        game,
        players: normalizedPlayers,
        playerMap: new Map(normalizedPlayers.map((player) => [player.id, player])),
        homeName: toText(team.name || game.homeTeamName, 'Home'),
        awayName: toText(game.opponent || game.opponentTeamName || game.awayTeamName, 'Opponent'),
        homeScore: toFiniteNumber(game.homeScore),
        awayScore: toFiniteNumber(game.awayScore),
        period: toText(game.period, DEFAULT_PERIOD),
        gameClockMs: Math.max(0, toFiniteNumber(game.liveClockMs ?? game.gameClockMs)),
        liveStatus: toText(game.liveStatus || game.status, 'scheduled').toLowerCase(),
        viewerCount: Math.max(0, toFiniteNumber(game.viewerCount)),
        onCourt: Array.isArray(game.liveLineup?.onCourt) ? [...game.liveLineup.onCourt] : [],
        bench: Array.isArray(game.liveLineup?.bench) ? [...game.liveLineup.bench] : [],
        stats: { ...(game.liveStats || game.stats || {}) },
        events: normalizedEvents,
        eventIds: new Set(normalizedEvents.map((event) => event.id)),
        chatMessages: normalizedChat,
        latestEvent: normalizedEvents[0] || null
    };
}

export function applyOverlayGame(state, game = {}) {
    if (!state) return state;
    state.game = { ...state.game, ...game };
    state.awayName = toText(game.opponent || game.opponentTeamName || game.awayTeamName, state.awayName);
    if (game.homeScore !== undefined) state.homeScore = toFiniteNumber(game.homeScore, state.homeScore);
    if (game.awayScore !== undefined) state.awayScore = toFiniteNumber(game.awayScore, state.awayScore);
    if (game.period) state.period = toText(game.period, state.period);
    if (game.liveClockMs !== undefined || game.gameClockMs !== undefined) {
        state.gameClockMs = Math.max(0, toFiniteNumber(game.liveClockMs ?? game.gameClockMs, state.gameClockMs));
    }
    if (game.liveStatus || game.status) state.liveStatus = toText(game.liveStatus || game.status, state.liveStatus).toLowerCase();
    if (game.viewerCount !== undefined) state.viewerCount = Math.max(0, toFiniteNumber(game.viewerCount));
    if (Array.isArray(game.liveLineup?.onCourt)) state.onCourt = [...game.liveLineup.onCourt];
    if (Array.isArray(game.liveLineup?.bench)) state.bench = [...game.liveLineup.bench];
    return state;
}

function applyEventStat(state, event) {
    if (!event.playerId || !event.statKey) return;
    const playerStats = { ...(state.stats[event.playerId] || {}) };
    const delta = toFiniteNumber(event.value);
    playerStats[event.statKey] = toFiniteNumber(playerStats[event.statKey]) + delta;
    state.stats = { ...state.stats, [event.playerId]: playerStats };
}

export function applyOverlayEvents(state, incomingEvents = []) {
    if (!state) return state;
    incomingEvents.forEach((rawEvent, index) => {
        const event = normalizeOverlayEvent(rawEvent, index);
        if (state.eventIds.has(event.id)) return;

        state.eventIds.add(event.id);
        if (event.type === 'reset') {
            state.events = [];
            state.eventIds = new Set([event.id]);
            state.stats = {};
        }
        if (rawEvent.homeScore !== undefined) state.homeScore = toFiniteNumber(rawEvent.homeScore, state.homeScore);
        if (rawEvent.awayScore !== undefined) state.awayScore = toFiniteNumber(rawEvent.awayScore, state.awayScore);
        if (rawEvent.period) state.period = toText(rawEvent.period, state.period);
        if (rawEvent.gameClockMs !== undefined) state.gameClockMs = Math.max(0, toFiniteNumber(rawEvent.gameClockMs, state.gameClockMs));
        applyEventStat(state, event);
        state.events = sortNewestFirst([event, ...state.events]).slice(0, 60);
        state.latestEvent = event;
    });
    return state;
}

export function replaceOverlayChat(state, messages = []) {
    if (!state) return state;
    state.chatMessages = sortNewestFirst(messages.map(normalizeChatMessage)).slice(0, 100);
    return state;
}

export function getOverlayLineup(state, group = 'onCourt') {
    if (!state) return [];
    const ids = group === 'bench' ? state.bench : state.onCourt;
    return ids
        .map((id) => state.playerMap.get(String(id)))
        .filter(Boolean)
        .map((player) => ({ ...player, stats: state.stats[player.id] || {} }));
}

export function createOverlayDemoFixture(now = Date.now()) {
    const players = [
        { id: 'p11', name: 'Bennett Kurtz', number: '11', position: 'F' },
        { id: 'p7', name: 'Dominic Persell', number: '7', position: 'M' },
        { id: 'p4', name: 'Ethan August', number: '4', position: 'D' },
        { id: 'p1', name: 'Mason Cole', number: '1', position: 'GK' },
        { id: 'p9', name: 'Nolan Brooks', number: '9', position: 'F' },
        { id: 'p18', name: 'Theo Grant', number: '18', position: 'M' }
    ];
    const game = {
        id: 'overlay-demo',
        opponent: 'Union KC 18/19 Jr Elite MO Navy',
        homeScore: 2,
        awayScore: 1,
        period: 'H2',
        liveClockMs: 24 * 60 * 1000 + 17 * 1000,
        liveStatus: 'live',
        viewerCount: 48,
        liveStats: {
            p11: { goals: 1, shots: 2 },
            p7: { shots: 2, assists: 1 },
            p1: { saves: 3 }
        },
        liveLineup: {
            onCourt: ['p11', 'p7', 'p4', 'p1'],
            bench: ['p9', 'p18']
        }
    };
    const events = [
        { id: 'e4', type: 'save', description: 'Cole holds a shot at the near post', playerId: 'p1', playerName: 'Mason Cole', playerNumber: '1', statKey: 'saves', value: 1, period: 'H2', gameClockMs: game.liveClockMs, homeScore: 2, awayScore: 1, createdAt: now - 7_000 },
        { id: 'e3', type: 'substitution', description: 'Grant enters for Persell', playerId: 'p18', playerName: 'Theo Grant', playerNumber: '18', period: 'H2', gameClockMs: game.liveClockMs + 75_000, homeScore: 2, awayScore: 1, createdAt: now - 52_000 },
        { id: 'e2', type: 'goal', description: 'Kurtz finishes the counterattack', playerId: 'p11', playerName: 'Bennett Kurtz', playerNumber: '11', statKey: 'goals', value: 1, period: 'H2', gameClockMs: game.liveClockMs + 160_000, homeScore: 2, awayScore: 1, createdAt: now - 110_000 },
        { id: 'e1', type: 'goal', description: 'Union KC levels from the penalty spot', isOpponent: true, statKey: 'goals', value: 1, period: 'H2', gameClockMs: game.liveClockMs + 390_000, homeScore: 1, awayScore: 1, createdAt: now - 330_000 }
    ];
    const chatMessages = [
        { id: 'c3', senderName: 'Coach Sarah', text: 'Great recovery shape after the sub.', createdAt: now - 14_000 },
        { id: 'c2', senderName: 'Soccer Dad', text: 'That save was huge!', createdAt: now - 38_000 },
        { id: 'c1', senderName: 'ALL PLAYS', text: 'Kurtz has the go-ahead goal for the Vipers.', ai: true, createdAt: now - 105_000 }
    ];
    return {
        team: { id: 'demo-team', name: 'Vipers' },
        game,
        players,
        events,
        chatMessages
    };
}
