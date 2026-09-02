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
    'videoReplayStatus'
]);

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
            videoId = parsed.searchParams.get('v');
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
    return Object.values(getGameReplayArchiveState(game)).some((value) => {
        if (value === null || value === undefined) return false;
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
