// Query values take precedence over older hash links, including explicit empty values.
export function parseOverlayParams(search = '', hash = '') {
    return {
        ...Object.fromEntries(new URLSearchParams(hash.replace(/^#\??/, ''))),
        ...Object.fromEntries(new URLSearchParams(search))
    };
}

export function resolveOverlayClip(params = {}, { durationMs = 0, videoMode = 'none' } = {}) {
    if (params.clipStart === undefined && params.clipEnd === undefined) return { status: 'none' };
    const startMs = Number(params.clipStart);
    const endMs = Number(params.clipEnd);
    if (String(params.clipStart ?? '').trim() === '' || String(params.clipEnd ?? '').trim() === '' ||
        !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
        return { status: 'invalid', message: 'This highlight has an invalid time range.' };
    }
    if (!['recorded', 'youtube'].includes(videoMode)) {
        return { status: 'unavailable', message: 'Highlight playback is unavailable for this video.' };
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return { status: 'pending', message: 'Loading highlight…' };
    }
    if (endMs > durationMs) {
        return { status: 'invalid', message: 'This highlight is outside the available recording.' };
    }
    return { status: 'active', startMs, endMs };
}

export function getOverlayReplayBounds(clip, durationMs) {
    return clip?.status === 'active'
        ? { startMs: clip.startMs, endMs: clip.endMs }
        : { startMs: 0, endMs: durationMs };
}

export function buildOverlayReplayUrl(href, { fullGame = false } = {}) {
    const url = new URL(href);
    const params = parseOverlayParams(url.search, url.hash);
    if (fullGame) {
        delete params.clipStart;
        delete params.clipEnd;
    }
    params.replay = 'true';
    url.search = new URLSearchParams(params).toString();
    url.hash = '';
    return url.toString();
}
