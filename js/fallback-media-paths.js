function sanitizePathSegment(value, fallback) {
    const sanitized = String(value || fallback || '')
        .trim()
        .replace(/[^\w.\-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return sanitized || fallback;
}

export function buildChatAttachmentFallbackPath(teamId, userId, fileName, ts = Date.now()) {
    const safeTeamId = sanitizePathSegment(teamId, 'unknown-team');
    const safeUserId = sanitizePathSegment(userId, 'unknown-user');
    const safeName = sanitizePathSegment(fileName, 'attachment');

    return `stat-sheets/team-chat/${safeTeamId}/${safeUserId}/${ts}_${safeName}`;
}

export function buildGameClipFallbackPath(teamId, gameId, userId, fileName, ts = Date.now()) {
    const safeTeamId = sanitizePathSegment(teamId, 'unknown-team');
    const safeGameId = sanitizePathSegment(gameId, 'unknown-game');
    const safeUserId = sanitizePathSegment(userId, 'unknown-user');
    const safeName = sanitizePathSegment(fileName, 'clip');

    return `game-clips/${safeTeamId}/${safeGameId}/${safeUserId}/${ts}_${safeName}`;
}
