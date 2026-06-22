function sanitizePathSegment(value, fallback, { allowPercent = false } = {}) {
    const pattern = allowPercent ? /[^%\w.\-]+/g : /[^\w.\-]+/g;
    const sanitized = String(value || fallback || '')
        .trim()
        .replace(pattern, '_')
        .replace(/^_+|_+$/g, '');
    return sanitized || fallback;
}

export function buildChatAttachmentFallbackPath(teamId, conversationId, userId, fileName, ts = Date.now()) {
    const safeTeamId = sanitizePathSegment(teamId, 'unknown-team');
    const safeConversationId = sanitizePathSegment(conversationId, 'team', { allowPercent: true });
    const safeUserId = sanitizePathSegment(userId, 'unknown-user');
    const safeName = sanitizePathSegment(fileName, 'attachment');

    return `stat-sheets/team-chat/${safeTeamId}/${safeConversationId}/${safeUserId}/${ts}_${safeName}`;
}

export function buildStatSheetFallbackPath(teamId, userId, fileName, ts = Date.now()) {
    const safeTeamId = sanitizePathSegment(teamId, 'unknown-team');
    const safeUserId = sanitizePathSegment(userId, 'unknown-user');
    const safeName = sanitizePathSegment(fileName, 'stat-sheet');

    return `stat-sheets/team-games/${safeTeamId}/${safeUserId}/${ts}_${safeName}`;
}

export function buildDrillDiagramFallbackPath(teamId, drillId, userId, fileName, ts = Date.now()) {
    const safeTeamId = sanitizePathSegment(teamId, 'unknown-team');
    const safeDrillId = sanitizePathSegment(drillId, 'unknown-drill');
    const safeUserId = sanitizePathSegment(userId, 'unknown-user');
    const safeName = sanitizePathSegment(fileName, 'diagram');

    return `stat-sheets/drills/${safeTeamId}/${safeDrillId}/${safeUserId}/${ts}_${safeName}`;
}

export function buildGameClipFallbackPath(teamId, gameId, userId, fileName, ts = Date.now()) {
    const safeTeamId = sanitizePathSegment(teamId, 'unknown-team');
    const safeGameId = sanitizePathSegment(gameId, 'unknown-game');
    const safeUserId = sanitizePathSegment(userId, 'unknown-user');
    const safeName = sanitizePathSegment(fileName, 'clip');

    return `game-clips/${safeTeamId}/${safeGameId}/${safeUserId}/${ts}_${safeName}`;
}
