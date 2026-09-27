import { createSecureUploadToken, requireSecureUploadToken } from './secure-upload-token.js?v=1';

function sanitizePathSegment(value, fallback) {
    const sanitized = String(value || fallback || '')
        .trim()
        .replace(/[^\w.\-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return sanitized || fallback;
}

export function buildDrillDiagramUploadPaths(teamId, drillId, userId, fileName, ts = Date.now(), nonce = createSecureUploadToken()) {
    const safeDrillId = String(drillId || 'unknown').replace(/[^\w.\-]+/g, '_');
    const safeName = String(fileName || 'diagram').replace(/[^\w.\-]+/g, '_');
    const safeTeamId = sanitizePathSegment(teamId, 'unknown-team');
    const safeUserId = sanitizePathSegment(userId, 'unknown-user');
    const safeNonce = requireSecureUploadToken(nonce);

    return {
        imagePath: `drill-diagrams/${safeDrillId}/${ts}_${safeNonce}_${safeName}`,
        fallbackPath: `stat-sheets/drills/${safeTeamId}/${safeDrillId}/${safeUserId}/${ts}_${safeNonce}_${safeName}`
    };
}
