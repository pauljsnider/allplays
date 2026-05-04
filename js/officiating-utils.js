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

            const officialId = String(slot?.officialId || '').trim();
            const officialEmail = normalizeOfficialEmail(slot?.officialEmail || slot?.email || '');
            const officialUserId = String(slot?.officialUserId || '').trim();
            const officialName = String(slot?.officialName || slot?.name || '').trim();
            const hasOfficial = !!(officialId || officialUserId || officialEmail || officialName);
            const requestedStatus = String(slot?.status || '').trim();
            const status = OFFICIATING_ASSIGNMENT_STATUSES.includes(requestedStatus)
                ? requestedStatus
                : (hasOfficial ? 'pending' : 'open');

            return {
                id: String(slot?.id || `slot-${index + 1}`).trim(),
                position,
                officialId,
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

function getDateMillis(dateValue) {
    if (!dateValue) return null;
    if (typeof dateValue.toMillis === 'function') return dateValue.toMillis();
    if (typeof dateValue.toDate === 'function') return dateValue.toDate().getTime();
    if (typeof dateValue.seconds === 'number') return dateValue.seconds * 1000;
    const parsed = dateValue instanceof Date ? dateValue : new Date(dateValue);
    const millis = parsed.getTime();
    return Number.isNaN(millis) ? null : millis;
}

function getGameWindow(game = {}, defaultGameMinutes = 120) {
    const start = getDateMillis(game.date);
    if (start === null) return null;
    const explicitEnd = getDateMillis(game.endTime || game.endDate || game.endsAt);
    const end = explicitEnd && explicitEnd > start
        ? explicitEnd
        : start + Math.max(1, Number(defaultGameMinutes) || 120) * 60000;
    return { start, end };
}

function getGameLabel(game = {}) {
    const opponent = String(game.opponent || game.title || 'TBD').trim();
    const location = String(game.location || '').trim();
    return location ? `vs. ${opponent} at ${location}` : `vs. ${opponent}`;
}

function getActiveOfficialAssignments(game = {}) {
    return normalizeOfficiatingSlots(game.officiatingSlots || [])
        .filter((slot) => !['open', 'declined', 'cant_make'].includes(slot.status))
        .map((slot) => {
            const identityKeys = [
                slot.officialId ? `id:${slot.officialId}` : '',
                slot.officialUserId ? `uid:${slot.officialUserId}` : '',
                slot.officialEmail ? `email:${slot.officialEmail}` : '',
                slot.officialName ? `name:${slot.officialName.toLowerCase()}` : ''
            ].filter(Boolean);
            return {
                slot,
                identityKeys,
                label: slot.officialName || slot.officialEmail || 'Official'
            };
        })
        .filter((assignment) => assignment.identityKeys.length > 0);
}

function hasSharedOfficialIdentity(a, b) {
    const keys = new Set(a.identityKeys);
    return b.identityKeys.some((key) => keys.has(key));
}

export function getOfficiatingAssignmentConflictWarnings(candidateGame = {}, existingGames = [], options = {}) {
    const candidateWindow = getGameWindow(candidateGame, options.defaultGameMinutes);
    if (!candidateWindow || !Array.isArray(existingGames)) return [];

    const candidateAssignments = getActiveOfficialAssignments(candidateGame);
    if (!candidateAssignments.length) return [];

    const candidateId = String(options.editingGameId || candidateGame.id || '').trim();
    const warnings = [];

    existingGames.forEach((existingGame) => {
        const existingId = String(existingGame?.id || '').trim();
        if (candidateId && existingId && candidateId === existingId) return;

        const existingWindow = getGameWindow(existingGame, options.defaultGameMinutes);
        if (!existingWindow) return;

        const overlaps = candidateWindow.start < existingWindow.end && existingWindow.start < candidateWindow.end;
        const backToBack = candidateWindow.end === existingWindow.start || existingWindow.end === candidateWindow.start;
        if (!overlaps && !backToBack) return;

        const existingAssignments = getActiveOfficialAssignments(existingGame);
        candidateAssignments.forEach((candidateAssignment) => {
            existingAssignments.forEach((existingAssignment) => {
                if (!hasSharedOfficialIdentity(candidateAssignment, existingAssignment)) return;
                warnings.push({
                    officialName: candidateAssignment.label || existingAssignment.label,
                    conflictType: overlaps ? 'overlap' : 'back-to-back',
                    candidateGameId: candidateId || null,
                    conflictingGameId: existingId || null,
                    candidateGameLabel: getGameLabel(candidateGame),
                    conflictingGameLabel: getGameLabel(existingGame)
                });
            });
        });
    });

    return warnings;
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
