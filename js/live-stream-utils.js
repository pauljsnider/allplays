export function normalizeYouTubeEmbedUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const raw = url.trim();
    if (!raw) return null;

    try {
        const parsed = new URL(raw);
        parsed.searchParams.set('autoplay', '1');
        parsed.searchParams.set('mute', '1');
        return parsed.toString();
    } catch {
        const [beforeHash, hash = ''] = raw.split('#');
        const queryIndex = beforeHash.indexOf('?');
        const base = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
        const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '';
        const params = new URLSearchParams(query);
        params.set('autoplay', '1');
        params.set('mute', '1');
        const normalized = `${base}?${params.toString()}`;
        return hash ? `${normalized}#${hash}` : normalized;
    }
}

export function computePanelVisibility({ isMobile, activeTab, hasVideoStream, shouldDefaultToVideo = false }) {
    if (!isMobile) {
        return {
            activeTab,
            videoHidden: !hasVideoStream,
            playsHidden: false,
            statsHidden: false,
            chatHidden: false
        };
    }

    const safeActiveTab = activeTab === 'video' && !hasVideoStream
        ? 'plays'
        : shouldDefaultToVideo && hasVideoStream ? 'video' : activeTab;
    return {
        activeTab: safeActiveTab,
        videoHidden: safeActiveTab !== 'video' || !hasVideoStream,
        playsHidden: safeActiveTab !== 'plays',
        statsHidden: safeActiveTab !== 'stats',
        chatHidden: safeActiveTab !== 'chat'
    };
}

export function hasConfiguredLiveStream(team = {}, game = {}) {
    return Boolean(
        game.streamEmbedUrl ||
        game.youtubeEmbedUrl ||
        game.youtubeVideoId ||
        game.twitchChannel ||
        team.streamEmbedUrl ||
        team.youtubeEmbedUrl ||
        team.youtubeVideoId ||
        team.twitchChannel
    );
}

function timestampToMs(value) {
    if (Number.isFinite(value)) return value;
    if (value?.toMillis) return value.toMillis();
    if (value?.toDate) return value.toDate().getTime();
    if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function resolveStreamRelativeTimestampMs({ game = {}, nowMs = Date.now(), gameClockMs = null } = {}) {
    const streamStartMs = timestampToMs(
        game.liveStreamStartedAtMs ??
        game.liveStreamStartedAt ??
        game.liveStartedAt ??
        game.streamStartedAt
    );
    const offsetMs = Number.isFinite(game.liveStreamOffsetMs)
        ? game.liveStreamOffsetMs
        : Number.isFinite(game.videoTimestampOffsetMs) ? game.videoTimestampOffsetMs : 0;

    if (Number.isFinite(streamStartMs)) {
        return Math.max(0, Math.round(nowMs - streamStartMs + offsetMs));
    }

    if (Number.isFinite(gameClockMs) && (Number.isFinite(game.liveStreamOffsetMs) || Number.isFinite(game.videoTimestampOffsetMs))) {
        return Math.max(0, Math.round(gameClockMs + offsetMs));
    }

    return null;
}

export function buildVideoTimestampMetadata({ team = {}, game = {}, nowMs = Date.now(), gameClockMs = null, isScoringEvent = false } = {}) {
    if (!isScoringEvent || !hasConfiguredLiveStream(team, game)) return {};

    const streamRelativeTimestampMs = resolveStreamRelativeTimestampMs({ game, nowMs, gameClockMs });
    return {
        videoTimestampCaptureActive: Number.isFinite(streamRelativeTimestampMs),
        streamRelativeTimestampMs,
        videoTimestampUnavailableReason: Number.isFinite(streamRelativeTimestampMs)
            ? null
            : 'stream_start_or_offset_unavailable'
    };
}
