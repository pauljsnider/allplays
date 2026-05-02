function normalizeText(value) {
    return String(value || '').trim();
}

function parseJerseyNumber(value) {
    const text = normalizeText(value);
    if (!text) return Number.POSITIVE_INFINITY;
    const parsed = Number.parseInt(text, 10);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function getLinkedFamilyCount(player = {}) {
    return Array.isArray(player.parents) ? player.parents.length : 0;
}

export function getVisibleContactCount(player = {}) {
    if (!Array.isArray(player.parents)) return 0;
    return player.parents.filter((parent) => {
        const email = normalizeText(parent?.email).toLowerCase();
        return email && email !== 'pending';
    }).length;
}

export function buildRosterRolloverPreviewRows(players = []) {
    return players
        .filter((player) => player?.active !== false)
        .map((player) => ({
            id: player.id,
            name: normalizeText(player.name) || 'Unnamed player',
            number: normalizeText(player.number),
            familyCount: getLinkedFamilyCount(player),
            contactCount: getVisibleContactCount(player)
        }))
        .sort((a, b) => {
            const numberDiff = parseJerseyNumber(a.number) - parseJerseyNumber(b.number);
            if (numberDiff !== 0) return numberDiff;
            return a.name.localeCompare(b.name);
        });
}
