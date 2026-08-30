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
        const leftTime = Number.isFinite(left.createdAtMs)
            ? left.createdAtMs
            : getTimestampMs(left.clientCreatedAt || left.createdAt || left.timestamp);
        const rightTime = Number.isFinite(right.createdAtMs)
            ? right.createdAtMs
            : getTimestampMs(right.clientCreatedAt || right.createdAt || right.timestamp);
        return rightTime - leftTime;
    });
}

function cloneStats(stats = {}) {
    return Object.fromEntries(Object.entries(stats || {}).map(([id, values]) => [id, { ...(values || {}) }]));
}

function escapeChatHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isSafeChatUrl(value) {
    try {
        const url = new URL(value, 'https://allplays.ai');
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function createLiveBaseline(game = {}, fallback = {}) {
    const liveLineup = game.liveLineup || {};
    return {
        homeScore: game.homeScore !== undefined ? toFiniteNumber(game.homeScore) : toFiniteNumber(fallback.homeScore),
        awayScore: game.awayScore !== undefined ? toFiniteNumber(game.awayScore) : toFiniteNumber(fallback.awayScore),
        period: toText(game.period, toText(fallback.period, DEFAULT_PERIOD)),
        gameClockMs: game.liveClockMs !== undefined || game.gameClockMs !== undefined
            ? Math.max(0, toFiniteNumber(game.liveClockMs ?? game.gameClockMs))
            : Math.max(0, toFiniteNumber(fallback.gameClockMs)),
        clockRunning: typeof game.liveClockRunning === 'boolean'
            ? game.liveClockRunning
            : fallback.clockRunning === true,
        onCourt: Array.isArray(liveLineup.onCourt)
            ? [...liveLineup.onCourt]
            : Array.isArray(fallback.onCourt) ? [...fallback.onCourt] : [],
        bench: Array.isArray(liveLineup.bench)
            ? [...liveLineup.bench]
            : Array.isArray(fallback.bench) ? [...fallback.bench] : [],
        opponentStats: game.opponentStats !== undefined
            ? cloneStats(game.opponentStats)
            : cloneStats(fallback.opponentStats),
        sport: game.sport || fallback.sport || null,
        periods: Array.isArray(game.periods)
            ? [...game.periods]
            : Array.isArray(fallback.periods) ? [...fallback.periods] : null,
        lastResetAt: game.liveResetAt !== undefined
            ? getTimestampMs(game.liveResetAt)
            : toFiniteNumber(fallback.lastResetAt),
        resetEventId: game.liveResetEventId !== undefined
            ? normalizeResetEventId(game.liveResetEventId)
            : normalizeResetEventId(fallback.resetEventId)
    };
}

function normalizeResetEventId(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && text.length <= 128 && !text.includes('/') ? text : '';
}

export function formatOverlayClock(milliseconds = 0) {
    const totalSeconds = Math.max(0, Math.floor(toFiniteNumber(milliseconds) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function getOverlayLiveClockMs({
    snapshotClockMs = 0,
    snapshotAtMs = 0,
    nowMs = Date.now(),
    clockRunning = false,
    isReplay = false,
    isCompleted = false
} = {}) {
    const clockMs = Math.max(0, toFiniteNumber(snapshotClockMs));
    const anchorMs = toFiniteNumber(snapshotAtMs);
    const currentMs = toFiniteNumber(nowMs, anchorMs);
    if (!clockRunning || isReplay || isCompleted || anchorMs <= 0) return clockMs;
    return clockMs + Math.max(0, currentMs - anchorMs);
}

export function getSafeOverlayProviderUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const url = new URL(value.trim());
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}

function getReplayAlignmentTimestampMs(item = {}) {
    return getTimestampMs(item?.clientCreatedAt || item?.createdAt || item?.timestamp);
}

function getReplayEpochTimestampMs(item = {}) {
    return getTimestampMs(item?.createdAt || item?.timestamp);
}

export function getOverlayReplayResetBoundaryMs({ replayEvents = [], fallbackResetAt = 0 } = {}) {
    const authoritativeResetAt = getTimestampMs(fallbackResetAt);
    if (authoritativeResetAt) return authoritativeResetAt;
    return replayEvents.reduce((latestResetAt, event) => {
        if (String(event?.type || '').toLowerCase() !== 'reset') return latestResetAt;
        return Math.max(latestResetAt, getReplayEpochTimestampMs(event));
    }, 0);
}

export function filterOverlayReplayStreams({
    replayEvents = [],
    replayChat = [],
    replayReactions = [],
    fallbackResetAt = 0
} = {}) {
    const resetBoundaryMs = getOverlayReplayResetBoundaryMs({ replayEvents, fallbackResetAt });
    if (!resetBoundaryMs) {
        return { replayEvents, replayChat, replayReactions, resetBoundaryMs: 0 };
    }
    const isInLatestEpoch = (item) => {
        // Reset metadata, chat, and reactions are server-stamped. Tracker
        // client clocks are useful for ordering a selected epoch, but cannot
        // safely decide whether an item landed before or after a server reset.
        const timestamp = getReplayEpochTimestampMs(item);
        return timestamp > 0 && timestamp >= resetBoundaryMs;
    };
    return {
        replayEvents: replayEvents.filter(isInLatestEpoch),
        replayChat: replayChat.filter(isInLatestEpoch),
        replayReactions: replayReactions.filter(isInLatestEpoch),
        resetBoundaryMs
    };
}

export function getOverlayReplayStartAt({
    replayEvents = [],
    replayChat = [],
    replayReactions = [],
    fallbackResetAt = 0,
    fallbackStartAt = Date.now()
} = {}) {
    const latestEpoch = filterOverlayReplayStreams({
        replayEvents,
        replayChat,
        replayReactions,
        fallbackResetAt
    });
    // A reset timestamp is the authoritative server-clock origin for the new
    // epoch. Using it also keeps server-stamped chat/reactions aligned when the
    // tracker device clock differs from Firestore's clock.
    if (latestEpoch.resetBoundaryMs) return latestEpoch.resetBoundaryMs;
    const eventStartCandidates = latestEpoch.replayEvents.flatMap((event) => {
        const timestamp = getReplayAlignmentTimestampMs(event);
        const gameClockMs = Number(event?.gameClockMs);
        if (!timestamp || !Number.isFinite(gameClockMs) || gameClockMs < 0) return [];
        return [timestamp - gameClockMs];
    });
    if (eventStartCandidates.length) return Math.min(...eventStartCandidates);

    const streamTimestamps = [
        ...latestEpoch.replayEvents,
        ...latestEpoch.replayChat,
        ...latestEpoch.replayReactions
    ]
        .map(getReplayAlignmentTimestampMs)
        .filter((timestamp) => timestamp > 0);
    return streamTimestamps.length
        ? Math.min(...streamTimestamps)
        : toFiniteNumber(fallbackStartAt, Date.now());
}

export function formatOverlayChatMessageHtml(text = '') {
    let formatted = escapeChatHtml(text);

    formatted = formatted.replace(
        /(^|\n)\s*[-*]\s+(?=\S)/g,
        '$1&bull; '
    );
    formatted = formatted.replace(
        /@all\s*plays/gi,
        '<span class="chat-mention">@ALL PLAYS</span>'
    );
    formatted = formatted.replace(
        /(\bhttps?:\/\/[^\s<]+[^\s<.,;:!?"'\])>]|\bwww\.[^\s<]+[^\s<.,;:!?"'\])>])/gi,
        (url) => {
            const href = url.startsWith('www.') ? `https://${url}` : url;
            if (!isSafeChatUrl(href)) return url;
            return `<a href="${escapeChatHtml(href)}" target="_blank" rel="noopener noreferrer" class="chat-link">${url}</a>`;
        }
    );
    formatted = formatted.replace(/`([^`]+)`/g, '<code class="chat-code">$1</code>');
    formatted = formatted.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\b_([^_]+)_\b/g, '<em>$1</em>');
    formatted = formatted.replace(/~([^~]+)~/g, '<del>$1</del>');

    return formatted;
}

export function getOverlayReplayDurationMs({
    replayEvents = [],
    replayChat = [],
    replayReactions = [],
    fallbackResetAt = 0,
    replayStartAt = 0,
    videoDurationMs = 0
} = {}) {
    const latestEpoch = filterOverlayReplayStreams({
        replayEvents,
        replayChat,
        replayReactions,
        fallbackResetAt
    });
    const eventDuration = latestEpoch.replayEvents.reduce((maximum, event) => {
        return Math.max(maximum, Math.max(0, toFiniteNumber(event?.gameClockMs)));
    }, 0);
    const streamDuration = [...latestEpoch.replayChat, ...latestEpoch.replayReactions].reduce((maximum, item) => {
        const timestamp = getReplayAlignmentTimestampMs(item);
        if (!timestamp || !Number.isFinite(replayStartAt)) return maximum;
        return Math.max(maximum, Math.max(0, timestamp - replayStartAt));
    }, 0);
    return Math.max(eventDuration, streamDuration, Math.max(0, toFiniteNumber(videoDurationMs)));
}

export function getControllableYouTubeEmbedUrl(sourceUrl, origin = '', { replay = false } = {}) {
    try {
        const url = new URL(sourceUrl);
        const isYouTube = ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com']
            .includes(url.hostname.toLowerCase());
        if (!isYouTube || !url.pathname.startsWith('/embed/')) return sourceUrl;

        if (replay) url.searchParams.set('autoplay', '0');
        url.searchParams.set('playsinline', '1');
        url.searchParams.set('enablejsapi', '1');
        if (origin) {
            const parsedOrigin = new URL(origin).origin;
            if (parsedOrigin.startsWith('http://') || parsedOrigin.startsWith('https://')) {
                url.searchParams.set('origin', parsedOrigin);
            }
        }
        return url.toString();
    } catch {
        return sourceUrl;
    }
}

export function getControllableReplayEmbedUrl(sourceUrl, origin = '') {
    return getControllableYouTubeEmbedUrl(sourceUrl, origin, { replay: true });
}

function getYouTubeVideoId(url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
        return url.pathname.split('/').filter(Boolean)[0] || '';
    }
    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return '';
    const pathMatch = url.pathname.match(/^\/(?:embed|live|shorts)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
    const candidate = url.searchParams.get('v') || pathMatch?.[1] || '';
    return candidate === 'live_stream' ? '' : candidate;
}

export function resolvePublicProjectionVideoOptions(game = {}, { parentHost = 'localhost' } = {}) {
    if (game?.isPublicProjection !== true) return null;
    const publicUrl = getSafeOverlayProviderUrl(game?.videoUrl);
    if (!publicUrl) return null;

    const url = new URL(publicUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const videoId = getYouTubeVideoId(url);
    if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        return {
            mode: 'embed',
            hasVideo: true,
            sourceUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1`,
            publicUrl,
            publicLabel: 'Watch on YouTube ↗',
            durationMs: null,
            replayState: null
        };
    }

    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        const channelId = url.searchParams.get('channel') || url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/)?.[1];
        if (/^UC[A-Za-z0-9_-]{22}$/.test(channelId || '')) {
            return {
                mode: 'embed',
                hasVideo: true,
                sourceUrl: `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channelId)}&autoplay=1&mute=1`,
                publicUrl,
                publicLabel: 'Watch on YouTube ↗',
                durationMs: null,
                replayState: null
            };
        }
        return null;
    }

    if (host === 'twitch.tv' || host === 'player.twitch.tv') {
        const safeParentHost = /^[A-Za-z0-9.-]+$/.test(parentHost) ? parentHost : 'localhost';
        const channel = host === 'player.twitch.tv'
            ? url.searchParams.get('channel')
            : url.pathname.split('/').filter(Boolean)[0];
        const video = host === 'player.twitch.tv'
            ? url.searchParams.get('video')
            : url.pathname.match(/^\/videos\/(\d+)(?:\/|$)/)?.[1];
        if (/^\d+$/.test(video || '')) {
            return {
                mode: 'embed',
                hasVideo: true,
                sourceUrl: `https://player.twitch.tv/?video=${encodeURIComponent(video)}&parent=${encodeURIComponent(safeParentHost)}&autoplay=true&muted=true`,
                publicUrl,
                publicLabel: 'Watch on Twitch ↗',
                durationMs: null,
                replayState: null
            };
        }
        if (channel !== 'videos' && /^[A-Za-z0-9_]{1,25}$/.test(channel || '')) {
            return {
                mode: 'embed',
                hasVideo: true,
                sourceUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(safeParentHost)}&autoplay=true&muted=true`,
                publicUrl,
                publicLabel: 'Watch on Twitch ↗',
                durationMs: null,
                replayState: null
            };
        }
        return null;
    }

    return {
        mode: 'recorded',
        hasVideo: true,
        sourceUrl: publicUrl,
        publicUrl,
        publicLabel: 'Open replay video ↗',
        durationMs: null,
        replayState: null
    };
}

export function parseYouTubeReplayTelemetry(data) {
    let payload = data;
    if (typeof payload === 'string') {
        try {
            payload = JSON.parse(payload);
        } catch {
            return null;
        }
    }
    if (!payload || typeof payload !== 'object' || payload.event !== 'infoDelivery') return null;

    const info = payload.info;
    if (!info || typeof info !== 'object') return null;
    if (info.currentTime === null || info.currentTime === '') return null;
    const currentTimeSeconds = Number(info.currentTime);
    if (!Number.isFinite(currentTimeSeconds) || currentTimeSeconds < 0) return null;

    const durationSeconds = Number(info.duration);
    const playerState = Number(info.playerState);
    const playbackRate = Number(info.playbackRate);
    return {
        currentTimeMs: Math.round(currentTimeSeconds * 1000),
        durationMs: Number.isFinite(durationSeconds) && durationSeconds >= 0
            ? Math.round(durationSeconds * 1000)
            : null,
        playerState: Number.isFinite(playerState) ? playerState : null,
        playbackRate: Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : null
    };
}

export function getOverlayEventTone(event = {}) {
    const type = toText(event.type).toLowerCase();
    const statKey = toText(event.statKey).toLowerCase();
    if (type === 'reset' || ['clock_pause', 'clock_start', 'clock_sync', 'period_change', 'undo', 'log_remove'].includes(type)) {
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
    const statKey = toText(event.statKey).toLowerCase();
    const description = toText(event.description, isScore ? 'Score recorded' : 'Game update');
    return {
        ...event,
        id: toText(event.id, `event-${index}-${getTimestampMs(event.clientCreatedAt || event.createdAt || event.timestamp)}`),
        description,
        // Missing state fields must stay missing. Supplying display defaults here
        // would make a note or substitution reset the canonical period/clock.
        period: toText(event.period),
        gameClockMs: event.gameClockMs === undefined
            ? undefined
            : Math.max(0, toFiniteNumber(event.gameClockMs)),
        tone,
        label: isScore
            ? (statKey === 'goals' || event.type === 'goal'
                ? 'GOAL'
                : (['pts', 'points'].includes(statKey) && toFiniteNumber(event.value) > 0
                    ? `+${toFiniteNumber(event.value)}`
                    : 'SCORE'))
            : '',
        // The retrying legacy tracker records the original client time before
        // Firestore replaces createdAt at eventual delivery. Prefer that stable
        // origin so a queued old score cannot sort after newer live updates.
        createdAtMs: getTimestampMs(event.clientCreatedAt || event.createdAt || event.timestamp),
        // Reset membership is a server-authoritative decision. Keep this
        // separate from the client timestamp used for ordering so tracker clock
        // skew cannot hide a valid post-reset event or revive a stale one.
        serverCreatedAtMs: getTimestampMs(event.createdAt || event.timestamp)
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
    const senderName = toText(message.senderName || message.name, 'Fan');
    return {
        ...message,
        id: toText(message.id, `message-${index}-${getTimestampMs(message.createdAt)}`),
        senderName,
        // Public chat rows are viewer-controlled. Until the server schema has
        // an authenticated platform-message type, none may claim official AI
        // identity or styling.
        ai: false,
        text: toText(message.text || message.message, ''),
        createdAtMs: getTimestampMs(message.createdAt)
    };
}

export function createOverlayState({ team = {}, game = {}, players = [], events = [], chatMessages = [] } = {}) {
    const normalizedPlayers = players.map(normalizePlayer);
    const normalizedEvents = sortNewestFirst(events.map(normalizeOverlayEvent));
    const normalizedChat = sortNewestFirst(chatMessages.map(normalizeChatMessage));
    const liveBaseline = createLiveBaseline(game);
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
        clockRunning: liveBaseline.clockRunning,
        liveStatus: toText(game.liveStatus || game.status, 'scheduled').toLowerCase(),
        viewerCount: Math.max(0, toFiniteNumber(game.liveViewerCount ?? game.viewerCount)),
        onCourt: Array.isArray(game.liveLineup?.onCourt) ? [...game.liveLineup.onCourt] : [],
        bench: Array.isArray(game.liveLineup?.bench) ? [...game.liveLineup.bench] : [],
        stats: { ...(game.liveStats || game.stats || {}) },
        opponentStats: { ...(game.opponentStats || {}) },
        events: normalizedEvents,
        eventIds: new Set(normalizedEvents.map((event) => event.id)),
        chatMessages: normalizedChat,
        latestEvent: normalizedEvents[0] || null,
        lastResetAt: getTimestampMs(game.liveResetAt),
        resetEventEpochInitialized: false,
        lastResetEventId: null,
        lastResetEventBoundaryMs: 0,
        lastAcknowledgedGameResetBoundaryMs: 0,
        lastAcknowledgedGameResetEventId: '',
        pendingGameResetBoundaryMs: 0,
        pendingGameResetPreviousEventBoundaryMs: 0,
        pendingGameResetEventId: '',
        lastStatChange: null,
        scoringRun: { team: null, points: 0 },
        lastRunAnnounced: 0,
        sport: game.sport || team.sport || null,
        periods: Array.isArray(game.periods) ? [...game.periods] : null,
        liveBaseline
    };
}

export function applyOverlayGame(state, game = {}, { preserveEventState = false } = {}) {
    if (!state) return state;
    const previousBaseline = state.liveBaseline || createLiveBaseline(state.game || {}, state);
    state.game = { ...state.game, ...game };
    const refreshedBaseline = createLiveBaseline(game, previousBaseline);
    if (game.liveResetAt !== undefined &&
        refreshedBaseline.lastResetAt > toFiniteNumber(previousBaseline.lastResetAt) &&
        game.liveResetEventId === undefined) {
        // Older public projections do not expose reset identity. Do not carry a
        // prior epoch's identity onto a newer timestamp while enrichment retries.
        refreshedBaseline.resetEventId = '';
    }
    state.liveBaseline = preserveEventState
        ? {
            ...refreshedBaseline,
            // Once the live-event listener has produced a nonempty snapshot,
            // its baseline must remain stable across the slower public game
            // projection. Otherwise a later correction/removal rebuilds from
            // whichever stale score happened to arrive in the 15-second poll.
            homeScore: previousBaseline.homeScore,
            awayScore: previousBaseline.awayScore,
            period: previousBaseline.period,
            gameClockMs: previousBaseline.gameClockMs,
            clockRunning: previousBaseline.clockRunning,
            onCourt: [...(previousBaseline.onCourt || [])],
            bench: [...(previousBaseline.bench || [])],
            lastResetAt: Math.max(
                toFiniteNumber(previousBaseline.lastResetAt),
                toFiniteNumber(refreshedBaseline.lastResetAt)
            )
        }
        : refreshedBaseline;
    state.awayName = toText(game.opponent || game.opponentTeamName || game.awayTeamName, state.awayName);
    if (!preserveEventState) {
        if (game.homeScore !== undefined) state.homeScore = toFiniteNumber(game.homeScore, state.homeScore);
        if (game.awayScore !== undefined) state.awayScore = toFiniteNumber(game.awayScore, state.awayScore);
        if (game.period) state.period = toText(game.period, state.period);
        if (game.liveClockMs !== undefined || game.gameClockMs !== undefined) {
            state.gameClockMs = Math.max(0, toFiniteNumber(game.liveClockMs ?? game.gameClockMs, state.gameClockMs));
        }
    }
    if (game.liveStatus || game.status) state.liveStatus = toText(game.liveStatus || game.status, state.liveStatus).toLowerCase();
    if (game.liveViewerCount !== undefined || game.viewerCount !== undefined) {
        state.viewerCount = Math.max(0, toFiniteNumber(game.liveViewerCount ?? game.viewerCount));
    }
    if (!preserveEventState && Array.isArray(game.liveLineup?.onCourt)) state.onCourt = [...game.liveLineup.onCourt];
    if (!preserveEventState && Array.isArray(game.liveLineup?.bench)) state.bench = [...game.liveLineup.bench];
    if (game.sport) state.sport = game.sport;
    if (Array.isArray(game.periods)) state.periods = [...game.periods];
    if (!preserveEventState && typeof game.liveClockRunning === 'boolean') {
        state.clockRunning = game.liveClockRunning;
    }
    return state;
}

export function reconcileOverlayLiveEvents(state, incomingEvents = [], stateTools = {}) {
    if (!state) return { processedEventIds: [], newEventIds: [] };
    if (typeof stateTools.collectVisibleLiveEventsSequentially !== 'function' ||
        typeof stateTools.applyResetEventState !== 'function' ||
        typeof stateTools.applyViewerEventToState !== 'function') {
        throw new Error('Canonical live event state tools are required.');
    }

    const priorEventIds = state.eventIds instanceof Set ? new Set(state.eventIds) : new Set();
    const uniqueIds = new Set();
    const orderedEvents = (Array.isArray(incomingEvents) ? incomingEvents : [])
        .map((event, index) => ({ event: normalizeOverlayEvent(event, index), index }))
        .sort((left, right) => left.event.createdAtMs - right.event.createdAtMs || left.index - right.index)
        .map(({ event }) => event)
        .filter((event) => {
            if (uniqueIds.has(event.id)) return false;
            uniqueIds.add(event.id);
            return true;
        });

    // applyOverlayGame maintains this baseline separately from the merged game
    // document. Re-reading state.game here would reintroduce a stale public
    // projection into event reconciliation after authority was transferred to
    // the live-event listener.
    const baseline = state.liveBaseline
        ? {
            ...state.liveBaseline,
            onCourt: [...(state.liveBaseline.onCourt || [])],
            bench: [...(state.liveBaseline.bench || [])],
            opponentStats: cloneStats(state.liveBaseline.opponentStats),
            periods: Array.isArray(state.liveBaseline.periods) ? [...state.liveBaseline.periods] : null
        }
        : createLiveBaseline(state.game || {}, state);
    state.liveBaseline = baseline;
    // The baseline is the game document's reset boundary. state.lastResetAt is
    // also advanced by reset events, so folding it into this value makes an
    // event marker look like a second game-document update.
    const configuredResetBoundaryMs = toFiniteNumber(baseline.lastResetAt);
    const configuredResetEventId = normalizeResetEventId(baseline.resetEventId);
    const resetEvents = orderedEvents.filter((event) => event.type === 'reset' && event.serverCreatedAtMs);
    const unseenResetEvents = resetEvents.filter((event) => (
        !priorEventIds.has(event.id) && event.id !== state.lastResetEventId
    ));
    const latestResetEvent = (events = []) => events.reduce((latest, event) => (
        !latest || event.serverCreatedAtMs > latest.serverCreatedAtMs ? event : latest
    ), null);
    const resetEpochInitialized = state.resetEventEpochInitialized === true;
    const lastResetEventBoundaryMs = toFiniteNumber(state.lastResetEventBoundaryMs);
    const lastAcknowledgedGameResetBoundaryMs = toFiniteNumber(state.lastAcknowledgedGameResetBoundaryMs);
    const lastAcknowledgedGameResetEventId = normalizeResetEventId(
        state.lastAcknowledgedGameResetEventId
    );
    const configuredBoundaryAdvanced = resetEpochInitialized &&
        configuredResetBoundaryMs > lastAcknowledgedGameResetBoundaryMs;
    const markerAwaitingGameBoundary = resetEpochInitialized &&
        lastResetEventBoundaryMs > lastAcknowledgedGameResetBoundaryMs;
    const pendingGameResetBoundaryMs = toFiniteNumber(state.pendingGameResetBoundaryMs);
    const pendingGameResetPreviousEventBoundaryMs = toFiniteNumber(
        state.pendingGameResetPreviousEventBoundaryMs
    );
    const pendingGameResetEventId = normalizeResetEventId(state.pendingGameResetEventId);
    let boundaryResetEvent = null;
    let resetBoundaryMs = lastResetEventBoundaryMs || configuredResetBoundaryMs;
    let nextPendingGameResetBoundaryMs = pendingGameResetBoundaryMs;
    let nextPendingGameResetPreviousEventBoundaryMs = pendingGameResetPreviousEventBoundaryMs;
    let nextPendingGameResetEventId = pendingGameResetEventId;
    const newestUnseenResetEvent = latestResetEvent(unseenResetEvents);
    const newestUnseenResetBoundaryMs = toFiniteNumber(newestUnseenResetEvent?.serverCreatedAtMs);

    if (!resetEpochInitialized) {
        boundaryResetEvent = latestResetEvent(resetEvents);
        const initialMarkerBoundaryMs = toFiniteNumber(boundaryResetEvent?.serverCreatedAtMs);
        const initialMarkerMatchesGame = configuredResetEventId &&
            boundaryResetEvent?.id === configuredResetEventId;
        resetBoundaryMs = initialMarkerMatchesGame || initialMarkerBoundaryMs > configuredResetBoundaryMs
            ? initialMarkerBoundaryMs
            : configuredResetBoundaryMs || initialMarkerBoundaryMs;
        if (configuredResetBoundaryMs && !initialMarkerMatchesGame &&
            initialMarkerBoundaryMs <= configuredResetBoundaryMs) {
            nextPendingGameResetBoundaryMs = configuredResetBoundaryMs;
            nextPendingGameResetPreviousEventBoundaryMs = 0;
            nextPendingGameResetEventId = configuredResetEventId;
        }
    } else if (configuredBoundaryAdvanced) {
        const unseenMarkerMatchesGame = configuredResetEventId &&
            newestUnseenResetEvent?.id === configuredResetEventId;
        const unseenMarkerFollowsGame = newestUnseenResetBoundaryMs > configuredResetBoundaryMs;
        if (newestUnseenResetBoundaryMs > lastResetEventBoundaryMs &&
            (!configuredResetEventId || unseenMarkerMatchesGame || unseenMarkerFollowsGame)) {
            // The game boundary and marker became visible in the same snapshot.
            boundaryResetEvent = newestUnseenResetEvent;
            resetBoundaryMs = newestUnseenResetBoundaryMs;
            nextPendingGameResetBoundaryMs = 0;
            nextPendingGameResetPreviousEventBoundaryMs = 0;
            nextPendingGameResetEventId = '';
        } else if (markerAwaitingGameBoundary &&
            (!configuredResetEventId || configuredResetEventId === state.lastResetEventId)) {
            // The marker was already applied. This game update acknowledges the
            // same reset without moving the event cutoff past intervening plays.
            resetBoundaryMs = lastResetEventBoundaryMs;
            if (configuredResetBoundaryMs >= lastResetEventBoundaryMs) {
                nextPendingGameResetBoundaryMs = 0;
                nextPendingGameResetPreviousEventBoundaryMs = 0;
                nextPendingGameResetEventId = '';
            }
        } else {
            // The game document arrived first. Keep its boundary as a temporary
            // cutoff so a later marker can move the cutoff back to the exact
            // event timestamp without reviving the prior epoch.
            resetBoundaryMs = configuredResetBoundaryMs;
            nextPendingGameResetBoundaryMs = configuredResetBoundaryMs;
            nextPendingGameResetPreviousEventBoundaryMs = lastResetEventBoundaryMs;
            nextPendingGameResetEventId = configuredResetEventId;
        }
    } else if (newestUnseenResetEvent) {
        const acceptsIdentifiedPendingGameMarker = pendingGameResetEventId &&
            newestUnseenResetEvent.id === pendingGameResetEventId;
        const acceptsLegacyPendingGameMarker = pendingGameResetBoundaryMs &&
            !pendingGameResetEventId &&
            newestUnseenResetBoundaryMs > pendingGameResetPreviousEventBoundaryMs;
        const acceptsPendingGameMarker = acceptsIdentifiedPendingGameMarker ||
            acceptsLegacyPendingGameMarker;
        const opensNewMarkerEpoch = newestUnseenResetBoundaryMs > lastResetEventBoundaryMs;
        if (acceptsPendingGameMarker || opensNewMarkerEpoch) {
            boundaryResetEvent = newestUnseenResetEvent;
            resetBoundaryMs = newestUnseenResetBoundaryMs;
            nextPendingGameResetBoundaryMs = 0;
            nextPendingGameResetPreviousEventBoundaryMs = 0;
            nextPendingGameResetEventId = '';
        }
    }
    const stateAfterNewerReset = resetBoundaryMs > toFiniteNumber(baseline.lastResetAt);
    const effectiveBaseline = stateAfterNewerReset
        ? {
            ...baseline,
            homeScore: toFiniteNumber(state.homeScore),
            awayScore: toFiniteNumber(state.awayScore),
            period: toText(state.period, baseline.period),
            gameClockMs: Math.max(0, toFiniteNumber(state.gameClockMs)),
            clockRunning: state.clockRunning === true,
            onCourt: Array.isArray(state.onCourt) ? [...state.onCourt] : [],
            bench: Array.isArray(state.bench) ? [...state.bench] : [],
            opponentStats: cloneStats(state.opponentStats),
            lastResetAt: resetBoundaryMs
        }
        : baseline;
    const resetEligibleEvents = orderedEvents
        .filter((event) => {
            if (!resetBoundaryMs || !event.serverCreatedAtMs) return true;
            return event.serverCreatedAtMs >= resetBoundaryMs;
        })
        .sort((left, right) => {
            const leftIsReset = left.type === 'reset';
            const rightIsReset = right.type === 'reset';
            if (leftIsReset !== rightIsReset) return leftIsReset ? -1 : 1;
            return 0;
        })
        .map((event) => event.type === 'reset' && resetBoundaryMs
            ? { ...event, createdAt: resetBoundaryMs }
            : event);
    const visibleEvents = stateTools.collectVisibleLiveEventsSequentially(resetEligibleEvents, {
        seenIds: new Set(),
        resetBoundaryMs
    });
    const snapshotEventIds = new Set(orderedEvents.map((event) => event.id));
    const opponentStatsBaseline = cloneStats(effectiveBaseline.opponentStats);
    visibleEvents.forEach((event) => {
        if (!event.isOpponent || !event.playerId || !event.statKey || !['stat', 'goal'].includes(event.type)) return;
        opponentStatsBaseline[event.playerId] = {
            ...(opponentStatsBaseline[event.playerId] || {}),
            [event.statKey]: 0
        };
    });

    let workingState = {
        ...state,
        homeScore: effectiveBaseline.homeScore,
        awayScore: effectiveBaseline.awayScore,
        period: effectiveBaseline.period,
        gameClockMs: effectiveBaseline.gameClockMs,
        clockRunning: effectiveBaseline.clockRunning,
        onCourt: [...effectiveBaseline.onCourt],
        bench: [...effectiveBaseline.bench],
        stats: {},
        // Public game projections can already contain the totals represented by
        // this complete live-event snapshot. Rebuild only event-backed keys from
        // zero so new stats and their negative corrections are both reflected,
        // while keeping baseline-only opponent metadata and stat fields intact.
        opponentStats: opponentStatsBaseline,
        events: [],
        eventIds: snapshotEventIds,
        latestEvent: null,
        lastStatChange: null,
        scoringRun: { team: null, points: 0 },
        lastRunAnnounced: 0,
        sport: effectiveBaseline.sport || state.sport || null,
        periods: Array.isArray(effectiveBaseline.periods) ? [...effectiveBaseline.periods] : state.periods || null,
        lastResetAt: resetBoundaryMs
    };

    visibleEvents.forEach((event) => {
        if (event.type === 'reset') {
            const resetAt = resetBoundaryMs || event.serverCreatedAtMs || event.createdAtMs || Date.now();
            workingState.lastResetAt = Math.max(workingState.lastResetAt || 0, resetAt);
            workingState = stateTools.applyResetEventState(workingState, event);
            workingState.eventIds = snapshotEventIds;
            workingState.clockRunning = false;
            return;
        }

        const transition = stateTools.applyViewerEventToState(workingState, event);
        workingState = transition.state;
        workingState.eventIds = snapshotEventIds;
        if (event.type === 'clock_start') workingState.clockRunning = true;
        if (event.type === 'clock_pause') workingState.clockRunning = false;
        if (typeof event.liveClockRunning === 'boolean') workingState.clockRunning = event.liveClockRunning;
    });

    if (['completed', 'complete', 'final', 'finished', 'cancelled', 'canceled'].includes(String(state.liveStatus || '').toLowerCase())) {
        workingState.clockRunning = false;
    }
    workingState.events = sortNewestFirst(workingState.events.map(normalizeOverlayEvent));
    workingState.latestEvent = workingState.events[0] || null;
    Object.assign(state, workingState);
    state.resetEventEpochInitialized = true;
    state.lastAcknowledgedGameResetBoundaryMs = Math.max(
        lastAcknowledgedGameResetBoundaryMs,
        configuredResetBoundaryMs
    );
    if (!resetEpochInitialized || configuredBoundaryAdvanced) {
        state.lastAcknowledgedGameResetEventId = configuredResetEventId;
    } else {
        state.lastAcknowledgedGameResetEventId = lastAcknowledgedGameResetEventId;
    }
    state.pendingGameResetBoundaryMs = nextPendingGameResetBoundaryMs;
    state.pendingGameResetPreviousEventBoundaryMs = nextPendingGameResetPreviousEventBoundaryMs;
    state.pendingGameResetEventId = nextPendingGameResetEventId;
    if (boundaryResetEvent) {
        state.lastResetEventId = boundaryResetEvent.id;
        state.lastResetEventBoundaryMs = resetBoundaryMs;
    } else if (!resetEpochInitialized || configuredBoundaryAdvanced) {
        state.lastResetEventBoundaryMs = resetBoundaryMs;
    }

    return {
        processedEventIds: visibleEvents.map((event) => event.id),
        newEventIds: visibleEvents.map((event) => event.id).filter((id) => !priorEventIds.has(id))
    };
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
        .map((id, index) => state.playerMap.get(String(id)) || {
            id: String(id),
            name: `Player ${index + 1}`,
            number: '',
            position: 'Roster details unavailable'
        })
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
