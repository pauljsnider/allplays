function normalizeDelimitedStrings(value) {
    const values = Array.isArray(value) ? value : String(value || '').split(',');
    return Array.from(new Set(values
        .map((item) => String(item || '').trim())
        .filter(Boolean)));
}

export function normalizeOfficialsDirectory(officials = []) {
    if (!Array.isArray(officials)) return [];
    return officials
        .map((official) => {
            const id = String(official?.id || '').trim();
            const name = String(official?.name || official?.displayName || official?.email || '').trim();
            if (!id || !name) return null;
            return {
                id,
                name,
                email: String(official?.email || '').trim(),
                phone: String(official?.phone || '').trim(),
                roles: normalizeDelimitedStrings(official?.roles),
                tags: normalizeDelimitedStrings(official?.tags)
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
}

export function getOfficialDisplayName(officialId, officials = []) {
    const match = officials.find((official) => official.id === officialId);
    return match?.name || '';
}

export function normalizeOfficiatingSlots(slots = [], officials = []) {
    if (!Array.isArray(slots)) return [];
    return slots
        .map((slot) => {
            const position = String(slot?.position || '').trim();
            if (!position) return null;
            const officialId = String(slot?.officialId || '').trim();
            const officialName = officialId
                ? (String(slot?.officialName || '').trim() || getOfficialDisplayName(officialId, officials))
                : '';
            return {
                position,
                officialId: officialId || null,
                officialName: officialName || null
            };
        })
        .filter(Boolean);
}

export function getOfficiatingCoverageState(slots = []) {
    const normalized = normalizeOfficiatingSlots(slots);
    if (normalized.length === 0) return 'unstaffed';
    const staffedCount = normalized.filter((slot) => !!slot.officialId).length;
    if (staffedCount === 0) return 'unstaffed';
    if (staffedCount === normalized.length) return 'fully staffed';
    return 'partially staffed';
}
