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

function compactString(value) {
    return value == null ? '' : String(value).trim();
}

export function normalizeFamilyShareChildren(children = []) {
    return (children || [])
        .map((child) => {
            const teamId = compactString(child?.teamId);
            const playerId = compactString(child?.playerId || child?.childId);
            return {
                teamId,
                teamName: compactString(child?.teamName || child?.team),
                playerId,
                playerName: compactString(child?.playerName || child?.childName || child?.name),
                playerNumber: compactString(child?.playerNumber ?? child?.number),
                playerPhotoUrl: child?.playerPhotoUrl || child?.photoUrl || null
            };
        })
        .filter((child) => child.teamId && child.playerId);
}
