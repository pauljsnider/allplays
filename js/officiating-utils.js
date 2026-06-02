export const OFFICIATING_ASSIGNMENT_STATUSES = ['pending', 'accepted', 'declined', 'cant_make', 'needs_review', 'open'];

function toWholeNumber(value) {
    if (value === '' || value === null || value === undefined) return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) return null;
    return numeric;
}

export function normalizeOfficiatingResult(result = null) {
    if (!result || typeof result !== 'object') return null;

    const homeScore = toWholeNumber(result.homeScore);
    const awayScore = toWholeNumber(result.awayScore);
    if (homeScore === null || awayScore === null) return null;

    return {
        homeScore,
        awayScore,
        notes: String(result.notes || '').trim(),
        submittedAt: result.submittedAt || null,
        submittedByUserId: String(result.submittedByUserId || '').trim(),
        submittedByEmail: normalizeOfficialEmail(result.submittedByEmail || ''),
        submittedByName: String(result.submittedByName || '').trim()
    };
}

export function hasSubmittedOfficiatingResult(slot = {}) {
    return !!normalizeOfficiatingResult(slot?.submittedResult || null);
}

export function validateOfficiatingResultSubmission(result = {}) {
    const homeScoreProvided = result.homeScore !== '' && result.homeScore !== null && result.homeScore !== undefined;
    const awayScoreProvided = result.awayScore !== '' && result.awayScore !== null && result.awayScore !== undefined;
    const homeScore = toWholeNumber(result.homeScore);
    const awayScore = toWholeNumber(result.awayScore);
    const errors = [];

    if (!homeScoreProvided) errors.push('Enter a home score.');
    else if (homeScore === null) errors.push('Home score must be a whole number 0 or greater.');

    if (!awayScoreProvided) errors.push('Enter an away score.');
    else if (awayScore === null) errors.push('Away score must be a whole number 0 or greater.');

    return {
        valid: errors.length === 0,
        errors,
        value: errors.length === 0
            ? {
                homeScore,
                awayScore,
                notes: String(result.notes || '').trim()
            }
            : null
    };
}

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

            const scheduleReviewRequired = slot?.scheduleReviewRequired === true
                || slot?.needsReview === true
                || slot?.rescheduled === true
                || status === 'needs_review';

            return {
                id: String(slot?.id || `slot-${index + 1}`).trim(),
                position,
                officialId,
                officialUserId,
                officialName,
                officialEmail,
                status: hasOfficial ? (status === 'open' ? 'pending' : status) : 'open',
                selfAssigned: slot?.selfAssigned === true,
                scheduleReviewRequired,
                scheduleReviewReason: scheduleReviewRequired ? String(slot?.scheduleReviewReason || 'Game schedule changed').trim() : '',
                scheduleReviewMarkedAt: scheduleReviewRequired ? (slot?.scheduleReviewMarkedAt || null) : null,
                submittedResult: normalizeOfficiatingResult(slot?.submittedResult || null)
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

function normalizeLocation(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function hasOfficiatingScheduleChange(previousGame = null, nextGame = {}) {
    if (!previousGame) return false;

    const previousDateMillis = getDateMillis(previousGame.date);
    const nextDateMillis = getDateMillis(nextGame.date);
    const dateChanged = previousDateMillis !== null
        && nextDateMillis !== null
        && previousDateMillis !== nextDateMillis;
    const locationChanged = normalizeLocation(previousGame.location) !== normalizeLocation(nextGame.location);

    return dateChanged || locationChanged;
}

export function flagRescheduledOfficiatingSlots(previousGame = null, nextGame = {}, options = {}) {
    const slots = normalizeOfficiatingSlots(nextGame.officiatingSlots || []);
    if (!hasOfficiatingScheduleChange(previousGame, nextGame)) return slots;

    const markedAt = options.markedAt || new Date().toISOString();
    return slots.map((slot) => {
        const hasAssignedOfficial = !!(slot.officialId || slot.officialUserId || slot.officialEmail || slot.officialName);
        if (!hasAssignedOfficial || ['declined', 'cant_make', 'open'].includes(slot.status)) return slot;

        return {
            ...slot,
            status: 'needs_review',
            scheduleReviewRequired: true,
            scheduleReviewReason: 'Game schedule changed',
            scheduleReviewMarkedAt: markedAt
        };
    });
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

function isCancelledGame(game = {}) {
    const status = String(game?.status || '').trim().toLowerCase();
    return status === 'cancelled' || status === 'canceled' || game?.deleted === true;
}

export function getOfficiatingAssignmentConflictWarnings(candidateGame = {}, existingGames = [], options = {}) {
    const candidateWindow = getGameWindow(candidateGame, options.defaultGameMinutes);
    if (!candidateWindow || isCancelledGame(candidateGame) || !Array.isArray(existingGames)) return [];

    const candidateAssignments = getActiveOfficialAssignments(candidateGame);
    if (!candidateAssignments.length) return [];

    const candidateId = String(options.editingGameId || candidateGame.id || '').trim();
    const warnings = [];

    existingGames.forEach((existingGame) => {
        if (isCancelledGame(existingGame)) return;

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
        return {
            ...slot,
            status,
            scheduleReviewRequired: false,
            scheduleReviewReason: '',
            scheduleReviewMarkedAt: null
        };
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

function doesOfficialMatchAssignedSlot(slot = {}, official = {}) {
    const officialUserId = String(official?.uid || '').trim();
    const officialEmail = normalizeOfficialEmail(official?.email || '');
    if (!officialUserId && !officialEmail) return false;
    if (slot.officialUserId && slot.officialUserId === officialUserId) return true;
    if (slot.officialEmail && slot.officialEmail === officialEmail) return true;
    return false;
}

export function updateOfficiatingSlotResult(slots = [], slotId, result = {}, official = {}, options = {}) {
    const submission = validateOfficiatingResultSubmission(result);
    if (!submission.valid) {
        throw new Error(submission.errors[0] || 'Enter a valid final score.');
    }

    let updated = false;
    const nextSlots = normalizeOfficiatingSlots(slots).map((slot) => {
        if (slot.id !== slotId) return slot;
        if (slot.status !== 'accepted') {
            throw new Error('Only accepted assignments can submit final results.');
        }
        if (!doesOfficialMatchAssignedSlot(slot, official)) {
            throw new Error('You can only submit a result for your own accepted assignment.');
        }

        updated = true;
        return {
            ...slot,
            submittedResult: {
                ...submission.value,
                submittedAt: options.submittedAt || new Date().toISOString(),
                submittedByUserId: String(official?.uid || '').trim(),
                submittedByEmail: normalizeOfficialEmail(official?.email || ''),
                submittedByName: String(official?.displayName || official?.name || official?.email || 'Official').trim()
            }
        };
    });

    if (!updated) throw new Error('Officiating slot not found');
    return nextSlots;
}
