export function normalizeFamilyShareCalendarUrls(urls = []) {
    const seen = new Set();
    return (urls || [])
        .map((url) => String(url || '').trim())
        .filter(Boolean)
        .filter((url) => {
            try {
                const parsed = new URL(url);
                return parsed.protocol === 'http:' || parsed.protocol === 'https:';
            } catch (_) {
                return false;
            }
        })
        .filter((url) => {
            if (seen.has(url)) return false;
            seen.add(url);
            return true;
        });
}

export function normalizeFamilyShareChildren(children = []) {
    return (children || [])
        .filter((child) => child?.teamId && child?.playerId)
        .map((child) => ({
            teamId: String(child.teamId || ''),
            teamName: String(child.teamName || ''),
            playerId: String(child.playerId || ''),
            playerName: String(child.playerName || ''),
            playerPhotoUrl: child.playerPhotoUrl || null
        }));
}
