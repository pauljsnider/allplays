export const OFFICIATING_ASSIGNMENT_STATUSES = ['pending', 'accepted', 'declined', 'cant_make', 'open'];

export function normalizeOfficialEmail(email) {
    return String(email || '').trim().toLowerCase();
}

export function normalizeOfficiatingSlots(slots = []) {
    if (!Array.isArray(slots)) return [];

    return slots
        .map((slot, index) => {
            const position = String(slot?.position || slot?.role || '').trim();
            if (!position) return null;

            const officialEmail = normalizeOfficialEmail(slot?.officialEmail || slot?.email || '');
            const officialUserId = String(slot?.officialUserId || '').trim();
            const officialName = String(slot?.officialName || slot?.name || '').trim();
            const hasOfficial = !!(officialUserId || officialEmail || officialName);
            const requestedStatus = String(slot?.status || '').trim();
            const status = OFFICIATING_ASSIGNMENT_STATUSES.includes(requestedStatus)
                ? requestedStatus
                : (hasOfficial ? 'pending' : 'open');

            return {
                id: String(slot?.id || `slot-${index + 1}`).trim(),
                position,
                officialUserId,
                officialName,
                officialEmail,
                status: hasOfficial ? (status === 'open' ? 'pending' : status) : 'open',
                selfAssigned: slot?.selfAssigned === true
            };
        })
        .filter(Boolean);
}

export function computeOfficiatingCoverageStatus(slots = []) {
    const normalized = normalizeOfficiatingSlots(slots);
    if (!normalized.length) return 'none';
    return normalized.every((slot) => slot.status === 'accepted') ? 'covered' : 'needs_attention';
}

export function getAssignedOfficiatingSlots(game = {}, user = {}) {
    const uid = String(user?.uid || '').trim();
    const email = normalizeOfficialEmail(user?.email || '');
    return normalizeOfficiatingSlots(game.officiatingSlots || [])
        .filter((slot) => (uid && slot.officialUserId === uid) || (email && slot.officialEmail === email));
}

export function getOpenOfficiatingSlots(game = {}) {
    if (game.officiatingSelfAssignmentEnabled !== true) return [];
    return normalizeOfficiatingSlots(game.officiatingSlots || [])
        .filter((slot) => !slot.officialUserId && !slot.officialEmail && !slot.officialName && slot.status === 'open');
}

export function updateOfficiatingSlotResponse(slots = [], slotId, status) {
    if (!['accepted', 'declined', 'cant_make'].includes(status)) {
        throw new Error('Unsupported officiating response');
    }

    let updated = false;
    const nextSlots = normalizeOfficiatingSlots(slots).map((slot) => {
        if (slot.id !== slotId) return slot;
        updated = true;
        return { ...slot, status };
    });

    if (!updated) throw new Error('Officiating slot not found');
    return nextSlots;
}

export function claimOfficiatingSlot(slots = [], slotId, official = {}) {
    const officialUserId = String(official?.uid || '').trim();
    const officialEmail = normalizeOfficialEmail(official?.email || '');
    const officialName = String(official?.displayName || official?.name || officialEmail || 'Official').trim();
    if (!officialUserId && !officialEmail) {
        throw new Error('Sign in before claiming an officiating slot');
    }

    let claimed = false;
    const nextSlots = normalizeOfficiatingSlots(slots).map((slot) => {
        if (slot.id !== slotId) return slot;
        if (slot.officialUserId || slot.officialEmail || slot.officialName || slot.status !== 'open') {
            throw new Error('This officiating slot is already filled');
        }
        claimed = true;
        return {
            ...slot,
            officialUserId,
            officialEmail,
            officialName,
            status: 'accepted',
            selfAssigned: true
        };
    });

    if (!claimed) throw new Error('Officiating slot not found');
    return nextSlots;
}
