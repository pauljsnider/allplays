const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com'
]);
const YOUTUBE_NOCOOKIE_HOSTS = new Set([
    'youtube-nocookie.com',
    'www.youtube-nocookie.com'
]);
const REPLAY_CONTAINER_FIELDS = Object.freeze(['replayVideo', 'recordedVideo', 'videoReplay']);
const REPLAY_DIRECT_FLAT_FIELDS = Object.freeze([
    'replayVideoUrl',
    'recordedVideoUrl',
    'videoReplayUrl',
    'archivedVideoUrl'
]);
const READY_REPLAY_STATUSES = new Set([
    'ready',
    'available',
    'complete',
    'completed',
    'archived',
    'published'
]);
const BLOCKED_REPLAY_STATUSES = new Set([
    'processing',
    'pending',
    'queued',
    'recording',
    'transcoding',
    'encoding',
    'failed',
    'error',
    'errored',
    'unavailable',
    'rejected'
]);
const ACTIVE_GAME_STATUSES = new Set(['live', 'in_progress', 'in-progress']);
const ACTIVE_GAME_COMPATIBLE_STATUSES = new Set([
    'scheduled',
    ...ACTIVE_GAME_STATUSES
]);
const TERMINAL_GAME_STATUSES = new Set([
    'completed',
    'final',
    'cancelled',
    'canceled',
    'deleted'
]);

export const GAME_REPLAY_ARCHIVE_FIELDS = Object.freeze([
    'replayVideo',
    'recordedVideo',
    'videoReplay',
    'replayVideoUrl',
    'recordedVideoUrl',
    'videoReplayUrl',
    'archivedVideoUrl',
    'replayVideoPublicUrl',
    'replayVideoPosterUrl',
    'replayVideoTitle',
    'replayVideoDurationMs',
    'replayStatus',
    'recordedReplayStatus',
    'videoReplayStatus',
    'videoUrl',
    'replayVideoFallbackDisabled'
]);

export const GAME_REPLAY_CLEAR_FIELDS = Object.freeze(
    GAME_REPLAY_ARCHIVE_FIELDS.filter((field) => ![
        'replayVideo',
        'videoUrl',
        'replayVideoFallbackDisabled'
    ].includes(field))
);

function extractPathVideoId(pathname, allowedPrefixes) {
    const match = pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (!match || !allowedPrefixes.has(match[1])) return null;
    return match[2];
}

function isValidVideoId(value) {
    return YOUTUBE_VIDEO_ID_PATTERN.test(value) && value !== 'live_stream';
}

/**
 * Normalize a URL for one exact YouTube video. Channel and generic live-feed
 * URLs are intentionally excluded because they can point at a different game
 * after the linked broadcast ends.
 */
export function normalizeYouTubeReplayUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;

    const raw = value.trim();
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        return null;
    }

    const rawAuthority = raw.match(/^https:\/\/([^/?#]+)/i)?.[1] || '';
    if (
        parsed.protocol !== 'https:' ||
        rawAuthority.toLowerCase() !== parsed.hostname.toLowerCase() ||
        parsed.username ||
        parsed.password ||
        parsed.port
    ) {
        return null;
    }

    const host = parsed.hostname.toLowerCase();
    let videoId = null;

    if (host === 'youtu.be') {
        const match = parsed.pathname.match(/^\/([^/]+)\/?$/);
        videoId = match?.[1] || null;
    } else if (YOUTUBE_HOSTS.has(host)) {
        if (/^\/watch\/?$/.test(parsed.pathname)) {
            const videoIds = parsed.searchParams.getAll('v');
            videoId = videoIds.length === 1 ? videoIds[0] : null;
        } else {
            videoId = extractPathVideoId(
                parsed.pathname,
                new Set(['embed', 'live', 'shorts'])
            );
        }
    } else if (YOUTUBE_NOCOOKIE_HOSTS.has(host)) {
        videoId = extractPathVideoId(parsed.pathname, new Set(['embed']));
    }

    if (!isValidVideoId(videoId || '')) return null;

    return {
        provider: 'youtube',
        videoId,
        embedUrl: `https://www.youtube.com/embed/${videoId}`,
        publicUrl: `https://www.youtube.com/watch?v=${videoId}`
    };
}

function cleanReplayString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function hasReplayFieldValue(value) {
    if (value === null || value === undefined) return false;
    return typeof value !== 'string' || Boolean(value.trim());
}

function toReplayObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeCredentialFreeHttpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const parsed = new URL(value.trim());
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function isYouTubeReplayHost(host) {
    return host === 'youtu.be' || YOUTUBE_HOSTS.has(host) || YOUTUBE_NOCOOKIE_HOSTS.has(host);
}

export function getGameReplayLifecycle(game = {}) {
    const type = game?.type;
    const readLifecycleStatus = (value) => {
        if (value === null || value === undefined || value === '') return '';
        if (typeof value !== 'string') return 'invalid';
        return value;
    };
    const status = readLifecycleStatus(game?.status);
    const liveStatus = readLifecycleStatus(game?.liveStatus);
    const completedStatuses = new Set(['completed', 'final']);
    const statuses = [status, liveStatus].filter(Boolean);
    const hasTerminalFlag = game?.isCancelled === true
        || game?.deleted === true
        || game?.isDeleted === true;
    const isGameType = type === undefined || type === 'game';

    return {
        type,
        status,
        liveStatus,
        isCompleted: isGameType && !hasTerminalFlag && ((completedStatuses.has(status)
                && (!liveStatus || completedStatuses.has(liveStatus) || liveStatus === 'scheduled'))
            || (!status && completedStatuses.has(liveStatus))),
        isActiveLive: isGameType
            && !hasTerminalFlag
            && statuses.some((value) => ACTIVE_GAME_STATUSES.has(value))
            && statuses.every((value) => ACTIVE_GAME_COMPATIBLE_STATUSES.has(value))
            && !statuses.some((value) => TERMINAL_GAME_STATUSES.has(value))
    };
}

function normalizeReplayAvailabilityStatus(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') return 'invalid';
    const normalized = value.trim().toLowerCase().replace(/[_\s-]+/g, '-');
    if (!normalized) return null;
    if (READY_REPLAY_STATUSES.has(normalized)) return 'ready';
    if (BLOCKED_REPLAY_STATUSES.has(normalized)) return 'blocked';
    return 'invalid';
}

function getReplayAvailabilityBoundary(game, replayObjects) {
    const statuses = [
        game?.replayStatus,
        game?.recordedReplayStatus,
        game?.videoReplayStatus,
        ...replayObjects.flatMap((value) => value ? [value.status, value.processingStatus] : [])
    ]
        .map(normalizeReplayAvailabilityStatus)
        .filter(Boolean);
    if (statuses.includes('invalid')) return 'invalid';
    if (statuses.includes('blocked')) return 'blocked';
    return 'safe';
}

function normalizeCanonicalYouTubeReplay(value) {
    if (!value || cleanReplayString(value.provider).toLowerCase() !== 'youtube') return null;

    const candidates = [];
    if (hasReplayFieldValue(value.videoId)) {
        if (typeof value.videoId !== 'string') return false;
        candidates.push(normalizeYouTubeReplayUrl(`https://youtu.be/${value.videoId.trim()}`));
    }
    for (const field of ['embedUrl', 'publicUrl']) {
        if (!hasReplayFieldValue(value[field])) continue;
        candidates.push(normalizeYouTubeReplayUrl(value[field]));
    }
    if (!candidates.length || candidates.some((candidate) => !candidate)) return false;
    if (new Set(candidates.map((candidate) => candidate.videoId)).size !== 1) return false;
    return candidates[0];
}

function normalizeHistoricalReplayObject(value) {
    if (!value) return null;
    const candidates = [];
    let genericPublicUrl = null;

    if (hasReplayFieldValue(value.publicUrl)) {
        if (typeof value.publicUrl !== 'string') return false;
        const publicReplay = normalizeYouTubeReplayUrl(value.publicUrl);
        if (publicReplay) {
            candidates.push(publicReplay);
        } else {
            genericPublicUrl = normalizeCredentialFreeHttpUrl(value.publicUrl);
            if (!genericPublicUrl || isYouTubeReplayHost(genericPublicUrl.hostname.toLowerCase())) return false;
        }
    }

    if (hasReplayFieldValue(value.provider)) {
        if (typeof value.provider !== 'string') return false;
        const provider = value.provider.trim().toLowerCase();
        if (provider === 'youtube' && !candidates.length
            && !hasReplayFieldValue(value.videoId)
            && !hasReplayFieldValue(value.embedUrl)) return false;
        if (provider && provider !== 'youtube' && (candidates.length
            || hasReplayFieldValue(value.videoId)
            || hasReplayFieldValue(value.embedUrl))) return false;
    }
    if (hasReplayFieldValue(value.videoId)) {
        if (typeof value.videoId !== 'string') return false;
        candidates.push(normalizeYouTubeReplayUrl(`https://youtu.be/${value.videoId.trim()}`));
    }
    if (hasReplayFieldValue(value.embedUrl)) {
        if (typeof value.embedUrl !== 'string') return false;
        candidates.push(normalizeYouTubeReplayUrl(value.embedUrl));
    }
    if (candidates.some((candidate) => !candidate)) return false;
    if (genericPublicUrl && candidates.length) return false;
    if (new Set(candidates.map((candidate) => candidate.videoId)).size > 1) return false;
    if (candidates.length) return { kind: 'youtube', replay: candidates[0] };
    return genericPublicUrl ? { kind: 'generic', publicUrl: genericPublicUrl.href } : null;
}

function normalizeDirectReplayCandidate(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const raw = value.trim();
    const parsed = normalizeCredentialFreeHttpUrl(raw);
    if (!parsed) return false;

    const host = parsed.hostname.toLowerCase();
    if (isYouTubeReplayHost(host)) {
        const normalized = normalizeYouTubeReplayUrl(raw);
        return normalized || false;
    }
    return {
        provider: null,
        videoId: null,
        sourceUrl: parsed.href,
        publicUrl: null
    };
}

function youtubePlaybackResult(normalized, sourceKind, isPublicProjectionVideo = false) {
    return {
        state: 'playable',
        mode: 'embed',
        provider: 'youtube',
        videoId: normalized.videoId,
        sourceUrl: normalized.embedUrl,
        publicUrl: normalized.publicUrl,
        sourceKind,
        isPublicProjectionVideo
    };
}

/**
 * Resolve the full-game replay source that raw legacy playback may use.
 * Standalone public aliases are exact YouTube identities; a safe generic
 * public URL is only a companion link for direct media. A malformed explicit
 * alias blocks lower-precedence fallbacks.
 */
export function resolveGameReplayPlaybackSource(game = {}) {
    if (!game || typeof game !== 'object' || Array.isArray(game)) {
        return { state: 'none' };
    }
    if (game.replayVideoFallbackDisabled === true) return { state: 'none' };

    const replayObjects = REPLAY_CONTAINER_FIELDS.map((field) => toReplayObject(game[field]));
    const availabilityState = getReplayAvailabilityBoundary(game, replayObjects);
    if (availabilityState !== 'safe') return { state: availabilityState };

    const canonicalReplay = normalizeCanonicalYouTubeReplay(replayObjects[0]);
    if (canonicalReplay === false) return { state: 'invalid' };
    if (canonicalReplay) return youtubePlaybackResult(canonicalReplay, 'canonical');

    for (let index = 0; index < REPLAY_CONTAINER_FIELDS.length; index += 1) {
        const rawValue = game[REPLAY_CONTAINER_FIELDS[index]];
        if (rawValue !== null && rawValue !== undefined && !replayObjects[index]) {
            return { state: 'invalid' };
        }
    }

    const publicCandidates = [];
    for (const replayObject of replayObjects) {
        if (!replayObject) continue;
        const provider = cleanReplayString(replayObject.provider).toLowerCase();
        const hasHistoricalIdentity = hasReplayFieldValue(replayObject.publicUrl)
            || hasReplayFieldValue(replayObject.videoId)
            || hasReplayFieldValue(replayObject.embedUrl)
            || provider === 'youtube';
        if (!hasHistoricalIdentity) continue;
        const normalized = normalizeHistoricalReplayObject(replayObject);
        if (!normalized) return { state: 'invalid' };
        publicCandidates.push(normalized);
    }
    if (hasReplayFieldValue(game.replayVideoPublicUrl)) {
        if (typeof game.replayVideoPublicUrl !== 'string') return { state: 'invalid' };
        const normalized = normalizeYouTubeReplayUrl(game.replayVideoPublicUrl);
        if (normalized) {
            publicCandidates.push({ kind: 'youtube', replay: normalized });
        } else {
            const genericPublicUrl = normalizeCredentialFreeHttpUrl(game.replayVideoPublicUrl);
            if (!genericPublicUrl || isYouTubeReplayHost(genericPublicUrl.hostname.toLowerCase())) {
                return { state: 'invalid' };
            }
            publicCandidates.push({ kind: 'generic', publicUrl: genericPublicUrl.href });
        }
    }

    const directValues = [
        replayObjects[0]?.url,
        replayObjects[0]?.src,
        replayObjects[1]?.url,
        replayObjects[1]?.src,
        replayObjects[2]?.url,
        replayObjects[2]?.src,
        ...REPLAY_DIRECT_FLAT_FIELDS.map((field) => game[field])
    ];
    const directCandidates = [];
    for (const value of directValues) {
        if (!hasReplayFieldValue(value)) continue;
        const normalized = normalizeDirectReplayCandidate(value);
        if (!normalized) return { state: 'invalid' };
        directCandidates.push(normalized);
    }

    const youtubeCandidates = [
        ...publicCandidates
            .filter((candidate) => candidate.kind === 'youtube')
            .map((candidate) => candidate.replay),
        ...directCandidates.filter((candidate) => candidate.provider === 'youtube')
    ];
    if (new Set(youtubeCandidates.map((candidate) => candidate.videoId)).size > 1) {
        return { state: 'invalid' };
    }

    const genericPublicUrls = publicCandidates
        .filter((candidate) => candidate.kind === 'generic')
        .map((candidate) => candidate.publicUrl);
    if (genericPublicUrls.length) {
        const hasDirectMedia = directCandidates.some((candidate) => candidate.provider !== 'youtube');
        if (!hasDirectMedia
            || youtubeCandidates.length
            || new Set(genericPublicUrls).size !== 1) {
            return { state: 'invalid' };
        }
    }

    if (directCandidates.length) {
        const selected = directCandidates[0];
        if (selected.provider === 'youtube') {
            return youtubePlaybackResult(selected, 'historical');
        }
        return {
            state: 'playable',
            mode: 'recorded',
            provider: null,
            videoId: null,
            sourceUrl: selected.sourceUrl,
            publicUrl: publicCandidates[0]?.kind === 'youtube'
                ? publicCandidates[0].replay.publicUrl
                : publicCandidates[0]?.publicUrl || null,
            sourceKind: 'direct',
            isPublicProjectionVideo: false
        };
    }

    if (publicCandidates.length) {
        return youtubePlaybackResult(publicCandidates[0].replay, 'historical');
    }

    if (hasReplayFieldValue(game.videoUrl) && getGameReplayLifecycle(game).isCompleted) {
        const normalized = normalizeYouTubeReplayUrl(game.videoUrl);
        if (!normalized) return { state: 'invalid' };
        return youtubePlaybackResult(normalized, 'videoUrl', game.isPublicProjection === true);
    }

    return { state: 'none' };
}

/**
 * Build the canonical game.replayVideo value persisted by legacy surfaces.
 */
export function buildYouTubeReplayVideo(value, metadata = {}) {
    const normalized = normalizeYouTubeReplayUrl(value);
    if (!normalized) return null;

    const safeMetadata = metadata && typeof metadata === 'object' ? metadata : {};
    const replayVideo = {
        ...normalized,
        status: 'ready'
    };
    const title = typeof safeMetadata.title === 'string' ? safeMetadata.title.trim() : '';
    const linkedBy = typeof safeMetadata.linkedBy === 'string' ? safeMetadata.linkedBy.trim() : '';

    if (title) replayVideo.title = title;
    if (linkedBy) replayVideo.linkedBy = linkedBy;
    if (safeMetadata.linkedAt !== null && safeMetadata.linkedAt !== undefined) {
        replayVideo.linkedAt = safeMetadata.linkedAt;
    }

    return replayVideo;
}

function stableReplayValue(value, seen = new WeakSet()) {
    if (value === null) return ['null'];
    if (value === undefined) return ['undefined'];
    if (typeof value === 'string') return ['string', value];
    if (typeof value === 'boolean') return ['boolean', value];
    if (typeof value === 'number') {
        if (Number.isNaN(value)) return ['number', 'NaN'];
        if (value === Infinity) return ['number', 'Infinity'];
        if (value === -Infinity) return ['number', '-Infinity'];
        if (Object.is(value, -0)) return ['number', '-0'];
        return ['number', value];
    }
    if (typeof value === 'bigint') return ['bigint', value.toString()];

    if (value instanceof Date) {
        const millis = value.getTime();
        if (Number.isNaN(millis)) return ['instant', 'invalid'];
        const seconds = Math.floor(millis / 1000);
        return ['instant', seconds, (millis - (seconds * 1000)) * 1_000_000];
    }

    if (typeof value !== 'object') {
        return [typeof value, String(value)];
    }

    const seconds = value.seconds;
    const nanoseconds = value.nanoseconds;
    if (
        typeof value.toDate === 'function' &&
        Number.isFinite(seconds) &&
        Number.isFinite(nanoseconds)
    ) {
        return ['instant', seconds, nanoseconds];
    }

    if (seen.has(value)) {
        throw new TypeError('Replay archive values cannot contain cycles.');
    }
    seen.add(value);

    let normalized;
    if (Array.isArray(value)) {
        normalized = ['array', value.map((entry) => stableReplayValue(entry, seen))];
    } else {
        normalized = [
            'object',
            Object.keys(value)
                .sort()
                .map((key) => [key, stableReplayValue(value[key], seen)])
        ];
    }

    seen.delete(value);
    return normalized;
}

export function getGameReplayArchiveState(game = {}) {
    if (!game || typeof game !== 'object') return {};

    return Object.fromEntries(
        GAME_REPLAY_ARCHIVE_FIELDS
            .filter((field) => Object.prototype.hasOwnProperty.call(game, field))
            .map((field) => [field, game[field]])
    );
}

export function hasGameReplayArchiveEvidence(game = {}) {
    if (game?.replayVideoFallbackDisabled === true) return false;
    return Object.entries(getGameReplayArchiveState(game)).some(([field, value]) => {
        if (field === 'replayVideoFallbackDisabled') return false;
        if (value === null || value === undefined) return false;
        if (field === 'videoUrl') {
            return getGameReplayLifecycle(game).isCompleted && Boolean(normalizeYouTubeReplayUrl(value));
        }
        return typeof value !== 'string' || Boolean(value.trim());
    });
}

/**
 * Fingerprint every replay field consumed by playback. Transactions compare the
 * complete raw state so older providers and future metadata cannot be silently
 * overwritten by a stale game report.
 */
export function fingerprintGameReplayArchiveState(game = {}) {
    return JSON.stringify(stableReplayValue(getGameReplayArchiveState(game)));
}
