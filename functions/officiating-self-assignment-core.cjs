const crypto = require('node:crypto');

const OFFICIATING_ASSIGNMENT_STATUSES = new Set(['pending', 'accepted', 'declined', 'cant_make', 'needs_review', 'open']);
const OFFICIATING_RESPONSE_STATUSES = new Set(['accepted', 'declined']);
const SHARED_GAME_ID_PREFIX = 'shared_';
const LEGACY_SHARED_GAME_ID_PREFIX = 'shared::';
const HASHED_SHARED_GAME_ID_PREFIX = 'sharedh_';
const MAX_SHARED_GAME_PATH_BYTES = 6144;
const MAX_FIRESTORE_SEGMENT_BYTES = 1500;

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
    if (!normalized || normalized.length > 128 || normalized.includes('/')) {
        throw createClaimError('invalid-argument', `${label} is required.`);
    }
    return normalized;
}

function normalizeSharedGamePath(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.trim();
    if (!normalized || Buffer.byteLength(normalized, 'utf8') > MAX_SHARED_GAME_PATH_BYTES) return '';
    const parts = normalized.split('/');
    if (parts.length < 4 || parts.length % 2 !== 0 || parts[parts.length - 2] !== 'sharedGames') return '';
    if (parts.some((part) => !part || part === '.' || part === '..' || Buffer.byteLength(part, 'utf8') > MAX_FIRESTORE_SEGMENT_BYTES)) {
        return '';
    }
    return normalized;
}

function buildSharedGameSyntheticId(sharedGamePath) {
    const normalizedPath = normalizeSharedGamePath(sharedGamePath);
    if (!normalizedPath) return '';
    const reversibleId = `${SHARED_GAME_ID_PREFIX}${encodeURIComponent(normalizedPath)}`;
    if (reversibleId.length <= 128) return reversibleId;
    const digest = crypto.createHash('sha256').update(normalizedPath, 'utf8').digest('base64url');
    return `${HASHED_SHARED_GAME_ID_PREFIX}${digest}`;
}

function isSharedGameSyntheticId(gameId) {
    return typeof gameId === 'string'
        && (
            gameId.startsWith(SHARED_GAME_ID_PREFIX)
            || gameId.startsWith(LEGACY_SHARED_GAME_ID_PREFIX)
            || gameId.startsWith(HASHED_SHARED_GAME_ID_PREFIX)
        );
}

function decodeSharedGameSyntheticId(gameId) {
    if (!isSharedGameSyntheticId(gameId)) return null;
    if (gameId.startsWith(HASHED_SHARED_GAME_ID_PREFIX)) return null;
    const prefix = gameId.startsWith(SHARED_GAME_ID_PREFIX)
        ? SHARED_GAME_ID_PREFIX
        : LEGACY_SHARED_GAME_ID_PREFIX;
    try {
        return normalizeSharedGamePath(decodeURIComponent(gameId.slice(prefix.length))) || null;
    } catch {
        return null;
    }
}

function normalizeOfficiatingGameReference(data = {}) {
    const gameId = normalizeDocId(data.gameId, 'Game ID');
    const rawSharedGamePath = typeof data.sharedGamePath === 'string' ? data.sharedGamePath.trim() : '';
    const sharedGamePath = normalizeSharedGamePath(rawSharedGamePath);
    if (rawSharedGamePath && !sharedGamePath) {
        throw createClaimError('invalid-argument', 'Shared game path is invalid.');
    }
    if (sharedGamePath) {
        if (!isSharedGameSyntheticId(gameId) || buildSharedGameSyntheticId(sharedGamePath) !== gameId) {
            throw createClaimError('invalid-argument', 'Shared game identity does not match its path.');
        }
    } else if (gameId.startsWith(HASHED_SHARED_GAME_ID_PREFIX)) {
        throw createClaimError('invalid-argument', 'Shared game path is required.');
    } else if (isSharedGameSyntheticId(gameId) && !decodeSharedGameSyntheticId(gameId)) {
        throw createClaimError('invalid-argument', 'Shared game identity is invalid.');
    }
    return {
        gameId,
        ...(sharedGamePath ? { sharedGamePath } : {})
    };
}

function resolveOfficiatingGamePath(teamId, gameId, sharedGamePath = '') {
    const normalizedSharedGamePath = normalizeSharedGamePath(sharedGamePath);
    if (normalizedSharedGamePath) {
        if (buildSharedGameSyntheticId(normalizedSharedGamePath) !== gameId) {
            throw createClaimError('invalid-argument', 'Shared game identity does not match its path.');
        }
        return normalizedSharedGamePath;
    }
    const sharedPath = decodeSharedGameSyntheticId(gameId);
    if (isSharedGameSyntheticId(gameId) && !sharedPath) {
        throw createClaimError('invalid-argument', 'Shared game path is required.');
    }
    return sharedPath || `teams/${teamId}/games/${gameId}`;
}

function isTeamLinkedToSharedGame(game = {}, teamId = '') {
    const normalizedTeamId = normalizeString(teamId);
    if (!normalizedTeamId) return false;

    if (normalizeString(game.homeTeamId) === normalizedTeamId) return true;
    if (normalizeString(game.awayTeamId) === normalizedTeamId) return true;
    const teamIds = Array.isArray(game.teamIds)
        ? game.teamIds.map(normalizeString).filter(Boolean)
        : [];
    return teamIds.includes(normalizedTeamId);
}

function normalizeOpenOfficiatingSlotClaimInput(data = {}) {
    const gameReference = normalizeOfficiatingGameReference(data);
    return {
        teamId: normalizeDocId(data.teamId, 'Team ID'),
        ...gameReference,
        slotId: normalizeDocId(data.slotId, 'Officiating slot ID'),
        displayName: normalizeString(data.displayName || data.name)
    };
}

function normalizeOfficiatingAssignmentResponseInput(data = {}) {
    const status = normalizeString(data.status).toLowerCase();
    if (!OFFICIATING_RESPONSE_STATUSES.has(status)) {
        throw createClaimError('invalid-argument', 'Officiating response must be accepted or declined.');
    }
    const gameReference = normalizeOfficiatingGameReference(data);
    return {
        teamId: normalizeDocId(data.teamId, 'Team ID'),
        ...gameReference,
        slotId: normalizeDocId(data.slotId, 'Officiating slot ID'),
        status
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
    // Email-based authority must come from the caller's current Auth token.
    const normalizedEmail = normalizeEmail(email);
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

function buildOfficiatingAssignmentResponseUpdate({ game = {}, slotId, status, official = {}, now = null } = {}) {
    const normalizedSlotId = normalizeDocId(slotId, 'Officiating slot ID');
    const normalizedStatus = normalizeString(status).toLowerCase();
    if (!OFFICIATING_RESPONSE_STATUSES.has(normalizedStatus)) {
        throw createClaimError('invalid-argument', 'Officiating response must be accepted or declined.');
    }
    const officialUserId = normalizeString(official.uid || official.userId);
    const officialEmail = normalizeEmail(official.email);
    if (!officialUserId) {
        throw createClaimError('unauthenticated', 'Sign in before responding to an officiating assignment.');
    }

    let updatedSlot = null;
    const officiatingSlots = normalizeOfficiatingSlots(game.officiatingSlots || []).map((slot) => {
        if (slot.id !== normalizedSlotId) return slot;
        const uidMatches = Boolean(slot.officialUserId && slot.officialUserId === officialUserId);
        // A stable UID binding is canonical. The email is only a legacy
        // fallback for assignments that have never been bound to a user ID.
        const emailMatches = Boolean(
            !slot.officialUserId &&
            officialEmail &&
            slot.officialEmail &&
            slot.officialEmail === officialEmail
        );
        if (!uidMatches && !emailMatches) {
            throw createClaimError('permission-denied', 'This officiating assignment belongs to another official.');
        }
        updatedSlot = {
            ...slot,
            status: normalizedStatus,
            scheduleReviewRequired: false,
            scheduleReviewReason: '',
            scheduleReviewMarkedAt: null
        };
        return updatedSlot;
    });

    if (!updatedSlot) {
        throw createClaimError('not-found', 'Officiating slot not found.');
    }
    return {
        update: {
            officiatingSlots,
            officiatingCoverageStatus: computeOfficiatingCoverageStatus(officiatingSlots),
            officiatingUpdatedAt: now
        },
        updatedSlot
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

function buildOfficiatingAssignmentResponseNotificationRecord({
    teamId,
    gameId,
    game = {},
    slot = {},
    status,
    actor = {},
    timestamp = null
} = {}) {
    const normalizedSlot = normalizeOfficiatingSlots([slot])[0] || slot;
    const actorUserId = normalizeString(actor.uid || actor.userId);
    const actorEmail = normalizeEmail(actor.email);
    const actorName = normalizeString(actor.displayName || actor.name);
    const normalizedStatus = normalizeString(status).toLowerCase();

    return {
        type: 'officiating_assignment',
        assignmentType: normalizedSlot.position || null,
        event: normalizedStatus === 'declined' ? 'declined' : 'accepted',
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
        status: normalizedStatus || normalizedSlot.status || null,
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
    buildSharedGameSyntheticId,
    normalizeSharedGamePath,
    normalizeOpenOfficiatingSlotClaimInput,
    normalizeOfficiatingAssignmentResponseInput,
    normalizeOfficiatingSlots,
    computeOfficiatingCoverageStatus,
    isEligibleOpenOfficiatingSlotParticipant,
    isSharedGameSyntheticId,
    decodeSharedGameSyntheticId,
    resolveOfficiatingGamePath,
    isTeamLinkedToSharedGame,
    claimOpenOfficiatingSlotForOfficial,
    buildOpenOfficiatingSlotClaimUpdate,
    buildOfficiatingSelfAssignmentNotificationRecord,
    buildOfficiatingAssignmentResponseUpdate,
    buildOfficiatingAssignmentResponseNotificationRecord
};
