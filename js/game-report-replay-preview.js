const YOUTUBE_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
    'youtu.be'
]);
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function parseHttpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;

    try {
        const url = new URL(value.trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        return url;
    } catch {
        return null;
    }
}

function isYouTubeUrl(url) {
    return Boolean(url && YOUTUBE_HOSTS.has(url.hostname.toLowerCase()));
}

function getYouTubeVideoId(url) {
    if (!isYouTubeUrl(url)) return null;

    const segments = url.pathname.split('/').filter(Boolean);
    const candidate = url.hostname.toLowerCase() === 'youtu.be'
        ? segments[0]
        : url.searchParams.get('v') || (['embed', 'shorts', 'live', 'v'].includes(segments[0]) ? segments[1] : '');

    return YOUTUBE_VIDEO_ID.test(candidate || '') ? candidate : null;
}

function getHttpsPosterUrl(value) {
    const url = parseHttpUrl(value);
    return url?.protocol === 'https:' ? url.href : null;
}

export function resolveGameReportReplayPreview({ sourceUrl, publicUrl, posterUrl } = {}) {
    const sourceUrls = [sourceUrl, publicUrl].map(parseHttpUrl).filter(Boolean);
    const youtubeSource = sourceUrls.find(isYouTubeUrl) || null;
    const youtubeVideoId = sourceUrls.map(getYouTubeVideoId).find(Boolean) || null;

    return {
        thumbnailUrl: getHttpsPosterUrl(posterUrl) || (youtubeVideoId
            ? `https://i.ytimg.com/vi/${youtubeVideoId}/mqdefault.jpg`
            : null),
        providerLabel: youtubeSource ? 'YouTube' : 'Video',
        accessibleLabel: youtubeSource
            ? 'Video available. Watch the full game replay on YouTube.'
            : 'Video available. Watch the full game replay.'
    };
}
