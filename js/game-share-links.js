const GAME_SHARE_ORIGIN = 'https://share.allplays.ai';
const MAX_SHARE_CLIP_MS = 24 * 60 * 60 * 1000;

function requireShareId(value, label) {
    const normalized = String(value || '').trim();
    if (!normalized) throw new TypeError(`${label} is required.`);
    return normalized;
}

function normalizeClipMs(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized < 0 || normalized > MAX_SHARE_CLIP_MS) return null;
    return Math.floor(normalized);
}

function buildGameShareUrl(pathname, { teamId, gameId }) {
    const url = new URL(pathname, GAME_SHARE_ORIGIN);
    url.searchParams.set('teamId', requireShareId(teamId, 'teamId'));
    url.searchParams.set('gameId', requireShareId(gameId, 'gameId'));
    return url;
}

export function buildGameWatchShareUrl({
    teamId,
    gameId,
    replay = false,
    clipStartMs = null,
    clipEndMs = null
}) {
    const url = buildGameShareUrl('/watch', { teamId, gameId });
    const startMs = normalizeClipMs(clipStartMs);
    const endMs = normalizeClipMs(clipEndMs);
    const hasClipRange = startMs !== null && endMs !== null && endMs > startMs;

    if (replay || hasClipRange) url.searchParams.set('replay', 'true');
    if (hasClipRange) {
        url.searchParams.set('clipStart', String(startMs));
        url.searchParams.set('clipEnd', String(endMs));
    }
    return url.toString();
}

export function buildGameReportShareUrl({ teamId, gameId }) {
    return buildGameShareUrl('/report', { teamId, gameId }).toString();
}
