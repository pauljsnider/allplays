function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeDate(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value?.toDate === 'function') {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    }
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function getCalendarOccurrenceTrackingId(calendarEventId, startsAt) {
    const normalizedEventId = normalizeText(calendarEventId);
    const normalizedStart = normalizeDate(startsAt);
    if (!normalizedEventId || !normalizedStart) return '';

    const occurrenceSuffix = `__${normalizedStart.toISOString()}`;
    return normalizedEventId.endsWith(occurrenceSuffix)
        ? normalizedEventId
        : `${normalizedEventId}${occurrenceSuffix}`;
}

export async function buildCalendarGameMaterializationId(
    teamId,
    calendarEventId,
    startsAt,
    cryptoApi = globalThis.crypto
) {
    const normalizedTeamId = normalizeText(teamId);
    const normalizedEventId = normalizeText(calendarEventId);
    const normalizedStart = normalizeDate(startsAt);
    if (!normalizedTeamId) throw new Error('Team is required.');
    if (!normalizedEventId) throw new Error('The imported calendar event is missing its calendar event ID.');
    if (!normalizedStart) throw new Error('The imported calendar event has an invalid start time.');
    if (!cryptoApi?.subtle || typeof TextEncoder === 'undefined') {
        throw new Error('This device cannot securely create a stable tracked event ID.');
    }

    // Keep this input identical to the React schedule materialization contract.
    const input = new TextEncoder().encode(
        `${normalizedTeamId}:${normalizedEventId}:${normalizedStart.toISOString()}`
    );
    const digest = await cryptoApi.subtle.digest('SHA-256', input);
    const digestHex = Array.from(
        new Uint8Array(digest),
        (byte) => byte.toString(16).padStart(2, '0')
    ).join('');
    return `calendar_${digestHex}`;
}

async function loadFirebaseDependencies() {
    return import('./firebase.js?v=26');
}

function getExistingGameId(snapshot) {
    const ids = (snapshot?.docs || [])
        .map((entry) => normalizeText(entry?.id))
        .filter(Boolean)
        .sort();
    return ids[0] || null;
}

export async function materializeCalendarGame({
    teamId,
    calendarEventId,
    startsAt,
    gameData,
    dependencies = null
}) {
    const normalizedTeamId = normalizeText(teamId);
    const normalizedEventId = normalizeText(calendarEventId);
    const normalizedStart = normalizeDate(startsAt);
    if (!normalizedTeamId) throw new Error('Team is required.');
    if (!normalizedEventId) throw new Error('The imported calendar event is missing its calendar event ID.');
    if (!normalizedStart) throw new Error('The imported calendar event has an invalid start time.');

    const firebase = dependencies || await loadFirebaseDependencies();
    const occurrenceId = getCalendarOccurrenceTrackingId(normalizedEventId, normalizedStart);
    const acceptedTrackingIds = [...new Set([normalizedEventId, occurrenceId].filter(Boolean))];
    const gamesRef = firebase.collection(firebase.db, `teams/${normalizedTeamId}/games`);
    const calendarIdConstraint = acceptedTrackingIds.length === 1
        ? firebase.where('calendarEventUid', '==', acceptedTrackingIds[0])
        : firebase.where('calendarEventUid', 'in', acceptedTrackingIds);
    const existingSnapshot = await firebase.getDocs(
        firebase.query(gamesRef, calendarIdConstraint, firebase.limit(10))
    );
    const existingGameId = getExistingGameId(existingSnapshot);
    if (existingGameId) {
        return existingGameId;
    }

    const gameId = await buildCalendarGameMaterializationId(
        normalizedTeamId,
        normalizedEventId,
        normalizedStart,
        firebase.cryptoApi || globalThis.crypto
    );
    const digest = gameId.slice('calendar_'.length);
    const actionId = `calendar-materialize:${digest}`;
    const importedBy = normalizeText(firebase.auth?.currentUser?.uid) || null;
    const now = typeof firebase.now === 'function' ? firebase.now() : new Date();
    const importedAt = normalizeDate(now)?.toISOString();
    if (!importedAt) {
        throw new Error('Unable to timestamp the imported calendar game.');
    }

    const gameRef = firebase.doc(firebase.db, `teams/${normalizedTeamId}/games/${gameId}`);
    await firebase.runTransaction(firebase.db, async (transaction) => {
        const existing = await transaction.get(gameRef);
        if (existing?.exists?.()) {
            const existingData = typeof existing.data === 'function' ? existing.data() : {};
            const storedTrackingId = normalizeText(existingData?.calendarEventUid);
            const storedActionId = normalizeText(existingData?.importBatch?.actionId);
            if (!acceptedTrackingIds.includes(storedTrackingId) && storedActionId !== actionId) {
                throw new Error('The deterministic calendar game ID is already in use.');
            }
            return;
        }

        transaction.set(gameRef, {
            ...(gameData || {}),
            assignments: Array.isArray(gameData?.assignments) ? gameData.assignments : [],
            // Legacy schedule filtering matches this parsed-event identity directly.
            // The deterministic document/action IDs still match the React app contract.
            calendarEventUid: normalizedEventId,
            source: 'calendar',
            sourceMetadata: {
                sourceType: 'calendar',
                sourceLabel: 'Imported calendar'
            },
            importBatch: {
                batchId: actionId,
                totalCount: 1,
                rowNumber: 1,
                importedAt,
                importedBy,
                actionId
            },
            createdAt: firebase.serverTimestamp(),
            createdBy: normalizeText(gameData?.createdBy) || importedBy
        });
    });

    return gameId;
}
