export function isAccessCodeExpired(expiresAt, nowMs = Date.now()) {
    if (!expiresAt) return false;

    let expiresAtMs;
    if (typeof expiresAt?.toMillis === 'function') {
        expiresAtMs = expiresAt.toMillis();
    } else if (expiresAt instanceof Date) {
        expiresAtMs = expiresAt.getTime();
    } else {
        expiresAtMs = Number(expiresAt);
    }

    if (!Number.isFinite(expiresAtMs)) return false;
    return nowMs > expiresAtMs;
}
