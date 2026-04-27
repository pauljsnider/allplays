export const MAX_GAME_CLIP_UPLOAD_SIZE = 50 * 1024 * 1024;

function toCleanString(value) {
    return String(value || '').trim();
}

function toFiniteNumber(value) {
    const num = typeof value === 'string' ? Number(value) : value;
    return Number.isFinite(num) ? num : null;
}

export function isSafeGameClipUrl(href) {
    if (!href) return false;
    try {
        const url = new URL(href, 'https://allplays.local');
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

export function validateGameClipFile(file) {
    if (!file) return;
    const mimeType = toCleanString(file.type).toLowerCase();
    if (!mimeType.startsWith('video/')) {
        throw new Error('Attach a video file or use an external video URL.');
    }
    if (Number.isFinite(file.size) && file.size > MAX_GAME_CLIP_UPLOAD_SIZE) {
        throw new Error('Game clips must be 50MB or smaller.');
    }
}

export function buildScoreLinkedClipRecord({
    teamId,
    gameId,
    event,
    playerIds = [],
    title = '',
    caption = '',
    media = {},
    createdBy = null
} = {}) {
    const mediaUrl = toCleanString(media.url || media.mediaUrl);
    if (!isSafeGameClipUrl(mediaUrl)) {
        throw new Error('Enter a valid http or https video URL.');
    }

    const selectedPlayerIds = Array.from(new Set(
        (Array.isArray(playerIds) ? playerIds : [])
            .map((id) => toCleanString(id))
            .filter(Boolean)
    ));

    const eventPlayerId = toCleanString(event?.playerId);
    if (eventPlayerId && !selectedPlayerIds.includes(eventPlayerId)) {
        selectedPlayerIds.unshift(eventPlayerId);
    }

    const scoreContext = {
        homeScore: toFiniteNumber(event?.homeScore),
        awayScore: toFiniteNumber(event?.awayScore),
        period: toCleanString(event?.period),
        gameClockMs: toFiniteNumber(event?.gameClockMs),
        scoringTeam: event?.isOpponent ? 'away' : 'home',
        points: toFiniteNumber(event?.value)
    };

    return {
        id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'score-linked',
        source: media.source === 'upload' ? 'upload' : 'external',
        mediaType: 'video',
        teamId: toCleanString(teamId),
        gameId: toCleanString(gameId),
        playEventId: toCleanString(event?.id),
        selectedPlayerIds,
        title: toCleanString(title) || toCleanString(event?.description) || 'Scored play clip',
        caption: toCleanString(caption),
        mediaUrl,
        url: mediaUrl,
        storagePath: toCleanString(media.path || media.storagePath),
        mimeType: toCleanString(media.mimeType || media.type) || null,
        sizeBytes: toFiniteNumber(media.size ?? media.sizeBytes),
        originalName: toCleanString(media.name) || null,
        scoreContext,
        createdBy: toCleanString(createdBy) || null,
        createdAtMs: Date.now()
    };
}

export function isScoredPlayEvent(event = {}) {
    return event?.statKey === 'pts' && Number(event?.value || 0) > 0;
}
