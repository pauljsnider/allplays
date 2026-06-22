const OFFICIATING_ASSIGNMENT_STATUSES = new Set(['pending', 'accepted', 'declined', 'cant_make', 'needs_review', 'open']);

function normalizeString(value) {
    return String(value || '').trim();
}

function normalizeEmail(value) {
    return normalizeString(value).toLowerCase();
}

function createClaimError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function normalizeDocId(value, label) {
    const normalized = normalizeString(value);
    if (!normalized || normalized.includes('/')) {
        throw createClaimError('invalid-argument', `${label} is required.`);
    }
    return normalized;
}

function normalizeOpenOfficiatingSlotClaimInput(data = {}) {
    return {
        teamId: normalizeDocId(data.teamId, 'Team ID'),
        gameId: normalizeDocId(data.gameId, 'Game ID'),
        slotId: normalizeDocId(data.slotId, 'Officiating slot ID'),
        displayName: normalizeString(data.displayName || data.name)
    };
}

function normalizeOfficiatingResult(result = null) {
    if (!result || typeof result !== 'object') return null;

    const homeScore = Number(result.homeScore);
    const awayScore = Number(result.awayScore);
    if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
        return null;
    }

    return {
        homeScore,
        awayScore,
        notes: normalizeString(result.notes),
        submittedAt: result.submittedAt || null,
        submittedByUserId: normalizeString(result.submittedByUserId),
        submittedByEmail: normalizeEmail(result.submittedByEmail),
        submittedByName: normalizeString(result.submittedByName)
    };
}

function normalizeOfficiatingSlots(slots = []) {
    if (!Array.isArray(slots)) return [];

    return slots.map((slot, index) => {
        const position = normalizeString(slot?.position || slot?.role);
        if (!position) return null;

        const officialId = normalizeString(slot?.officialId);
        const officialUserId = normalizeString(slot?.officialUserId);
        const officialEmail = normalizeEmail(slot?.officialEmail || slot?.email);
        const officialName = normalizeString(slot?.officialName || slot?.name);
        const hasOfficial = Boolean(officialId || officialUserId || officialEmail || officialName);
        const requestedStatus = normalizeString(slot?.status);
        const status = OFFICIATING_ASSIGNMENT_STATUSES.has(requestedStatus)
            ? requestedStatus
            : (hasOfficial ? 'pending' : 'open');
        const scheduleReviewRequired = slot?.scheduleReviewRequired === true ||
            slot?.needsReview === true ||
            slot?.rescheduled === true ||
            status === 'needs_review';

        return {
            id: normalizeString(slot?.id || `slot-${index + 1}`),
            position,
            officialId,
            officialUserId,
            officialName,
            officialEmail,
            status: hasOfficial ? (status === 'open' ? 'pending' : status) : 'open',
            selfAssigned: slot?.selfAssigned === true,
            scheduleReviewRequired,
            scheduleReviewReason: scheduleReviewRequired ? normalizeString(slot?.scheduleReviewReason || 'Game schedule changed') : '',
            scheduleReviewMarkedAt: scheduleReviewRequired ? (slot?.scheduleReviewMarkedAt || null) : null,
            submittedResult: normalizeOfficiatingResult(slot?.submittedResult || null)
        };
    }).filter(Boolean);
}

function computeOfficiatingCoverageStatus(slots = []) {
    const normalized = normalizeOfficiatingSlots(slots);
    if (!normalized.length) return 'none';
    return normalized.every((slot) => slot.status === 'accepted') ? 'covered' : 'needs_attention';
}

function isEligibleOpenOfficiatingSlotParticipant({ team = {}, user = {}, uid = '', email = '', teamId = '' } = {}) {
    const normalizedUid = normalizeString(uid);
    if (!normalizedUid) return false;

    const normalizedTeamId = normalizeString(teamId || team.id);
    const normalizedEmail = normalizeEmail(email || user.email || user.profileEmail);
    if (team.ownerId === normalizedUid) return true;
    if (user.isAdmin === true) return true;

    const adminEmails = Array.isArray(team.adminEmails)
        ? team.adminEmails.map(normalizeEmail).filter(Boolean)
        : [];
    if (normalizedEmail && adminEmails.includes(normalizedEmail)) return true;

    const parentTeamIds = Array.isArray(user.parentTeamIds)
        ? user.parentTeamIds.map(normalizeString).filter(Boolean)
        : [];
    return Boolean(normalizedTeamId && parentTeamIds.includes(normalizedTeamId));
}

function claimOpenOfficiatingSlotForOfficial(slots = [], slotId, official = {}) {
    const normalizedSlotId = normalizeString(slotId);
    const officialUserId = normalizeString(official.uid || official.userId);
    const officialEmail = normalizeEmail(official.email);
    const officialName = normalizeString(official.displayName || official.name || officialEmail || 'Official');
    if (!officialUserId && !officialEmail) {
        throw createClaimError('unauthenticated', 'Sign in before claiming an officiating slot.');
    }

    let claimed = false;
    const nextSlots = normalizeOfficiatingSlots(slots).map((slot) => {
        if (slot.id !== normalizedSlotId) return slot;
        if (slot.officialUserId || slot.officialEmail || slot.officialName || slot.status !== 'open') {
            throw createClaimError('failed-precondition', 'This officiating slot is already filled.');
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

    if (!claimed) {
        throw createClaimError('not-found', 'Officiating slot not found.');
    }
    return nextSlots;
}

function uniqueStrings(values = []) {
    return Array.from(new Set((Array.isArray(values) ? values : []).map(normalizeString).filter(Boolean)));
}

function buildOpenOfficiatingSlotClaimUpdate({ game = {}, slotId, official = {}, now = null } = {}) {
    if (game.officiatingSelfAssignmentEnabled !== true) {
        throw createClaimError('failed-precondition', 'Self-assignment is not enabled for this game.');
    }

    const officiatingSlots = claimOpenOfficiatingSlotForOfficial(game.officiatingSlots || [], slotId, official);
    const claimedSlot = officiatingSlots.find((slot) => slot.id === normalizeString(slotId)) || null;
    const officialUserId = normalizeString(official.uid || official.userId);
    const officialEmail = normalizeEmail(official.email);
    const officiatingAuthorizedUserIds = uniqueStrings([
        ...uniqueStrings(game.officiatingAuthorizedUserIds),
        officialUserId
    ]);
    const officiatingAuthorizedEmails = uniqueStrings([
        ...uniqueStrings(game.officiatingAuthorizedEmails).map(normalizeEmail),
        officialEmail
    ]);

    return {
        update: {
            officiatingSlots,
            officiatingCoverageStatus: computeOfficiatingCoverageStatus(officiatingSlots),
            officiatingUpdatedAt: now,
            officiatingAuthorizedUserIds,
            officiatingAuthorizedEmails
        },
        claimedSlot
    };
}

function buildOfficiatingSelfAssignmentNotificationRecord({
    teamId,
    gameId,
    game = {},
    slot = {},
    actor = {},
    timestamp = null
} = {}) {
    const normalizedSlot = normalizeOfficiatingSlots([slot])[0] || slot;
    const actorUserId = normalizeString(actor.uid || actor.userId);
    const actorEmail = normalizeEmail(actor.email);
    const actorName = normalizeString(actor.displayName || actor.name);

    return {
        type: 'officiating_assignment',
        assignmentType: normalizedSlot.position || null,
        event: 'self_assigned',
        gameReference: {
            teamId: normalizeString(teamId),
            gameId: normalizeString(gameId || game.id),
            opponent: normalizeString(game.opponent) || null,
            location: normalizeString(game.location) || null,
            date: game.date || null
        },
        gameId: normalizeString(gameId || game.id),
        slotId: normalizedSlot.id || null,
        position: normalizedSlot.position || null,
        status: normalizedSlot.status || null,
        timestamp,
        actor: {
            userId: actorUserId,
            name: actorName,
            email: actorEmail
        },
        actorUserId: actorUserId || null,
        actorEmail: actorEmail || null,
        recipientType: 'assigner',
        recipientOfficialId: normalizedSlot.officialId || null,
        recipientOfficialUserId: normalizedSlot.officialUserId || null,
        recipientOfficialName: normalizedSlot.officialName || null,
        recipientOfficialEmail: normalizedSlot.officialEmail || null,
        read: false
    };
}

module.exports = {
    normalizeOpenOfficiatingSlotClaimInput,
    normalizeOfficiatingSlots,
    computeOfficiatingCoverageStatus,
    isEligibleOpenOfficiatingSlotParticipant,
    claimOpenOfficiatingSlotForOfficial,
    buildOpenOfficiatingSlotClaimUpdate,
    buildOfficiatingSelfAssignmentNotificationRecord
};
