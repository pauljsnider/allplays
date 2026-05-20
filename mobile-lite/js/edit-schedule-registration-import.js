function normalizeString(value) {
    return String(value || '').trim();
}

function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === 'function') return toDate(value.toDate());
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getExternalEventId(event = {}) {
    return normalizeString(event.externalEventId || event.sourceEventId || event.providerEventId || event.id);
}

function getEventSourceMetadata(event = {}, source = {}) {
    const sourceType = normalizeString(source.type || source.provider || source.name || 'registration');
    const sourceId = normalizeString(source.id || source.sourceId || source.providerId || source.registrationSourceId || 'registration');
    return {
        sourceType,
        sourceId,
        externalEventId: getExternalEventId(event),
        importedAt: new Date().toISOString()
    };
}

function getExistingExternalEventId(event = {}) {
    return normalizeString(
        event.sourceMetadata?.externalEventId ||
        event.registrationSource?.externalEventId ||
        event.externalEventId ||
        event.sourceEventId
    );
}

function getSourceKey(source = {}) {
    return `${normalizeString(source.sourceType || source.type || source.provider || source.name || 'registration').toLowerCase()}::${normalizeString(source.sourceId || source.id || source.providerId || source.registrationSourceId || 'registration').toLowerCase()}`;
}

function getExistingSourceKey(event = {}) {
    const metadata = event.sourceMetadata || event.registrationSource || {};
    return getSourceKey(metadata);
}

function getExternalEventKey(externalEventId, source = {}) {
    return `${getSourceKey(source)}::${normalizeString(externalEventId).toLowerCase()}`;
}

function getComparableTitle(event = {}) {
    return normalizeString(event.opponent || event.title).toLowerCase();
}

function isSameLocalEvent(sourceEvent, existingEvent) {
    const sourceDate = toDate(sourceEvent.date || sourceEvent.start || sourceEvent.startTime || sourceEvent.startsAt);
    const existingDate = toDate(existingEvent.date || existingEvent.start || existingEvent.startTime);
    if (!sourceDate || !existingDate || sourceDate.getTime() !== existingDate.getTime()) return false;

    const sourceTitle = normalizeString(sourceEvent.opponent || sourceEvent.title || sourceEvent.summary).toLowerCase();
    return sourceTitle && sourceTitle === getComparableTitle(existingEvent);
}

function normalizeComparableValue(value) {
    if (value?.toDate) return normalizeComparableValue(value.toDate());
    const date = toDate(value);
    if (date && (value instanceof Date || typeof value === 'string' || value?.toDate)) return date.toISOString();
    if (value === null || typeof value === 'undefined') return '';
    return String(value).trim();
}

function isUnchangedImportedEvent(payload = {}, existingEvent = {}) {
    const existingType = normalizeString(existingEvent.type || 'game').toLowerCase();
    const payloadType = normalizeString(payload.type || 'game').toLowerCase();
    const fields = ['opponent', 'title', 'location', 'notes', 'status', 'isHome'];
    const fieldMatches = payloadType === existingType && fields.every((field) => (
        !Object.prototype.hasOwnProperty.call(payload, field) ||
        normalizeComparableValue(payload[field]) === normalizeComparableValue(existingEvent[field])
    ));
    const dateMatches = normalizeComparableValue(payload.date) === normalizeComparableValue(existingEvent.date || existingEvent.start || existingEvent.startTime);
    const endMatches = !Object.prototype.hasOwnProperty.call(payload, 'end') ||
        normalizeComparableValue(payload.end) === normalizeComparableValue(existingEvent.end || existingEvent.endTime || existingEvent.endsAt);
    return fieldMatches && dateMatches && endMatches;
}

export function isExternallyLinkedRegistrationTeam(team = {}) {
    return !!(
        team.registrationSource ||
        team.registrationSourceId ||
        team.externalRegistrationTeamId ||
        team.registrationSourceSnapshot ||
        team.registrationScheduleSnapshot
    );
}

export function getRegistrationScheduleEvents(team = {}) {
    const candidates = [
        team.registrationScheduleSnapshot?.events,
        team.registrationSourceSnapshot?.scheduleEvents,
        team.registrationSourceSnapshot?.events,
        team.registrationSource?.scheduleEvents,
        team.registrationSource?.events,
        team.externalScheduleEvents
    ];
    return candidates.find(Array.isArray) || [];
}

export function buildRegistrationScheduleEventPayload(sourceEvent = {}, { Timestamp, source = {} } = {}) {
    const externalEventId = getExternalEventId(sourceEvent);
    const startDate = toDate(sourceEvent.date || sourceEvent.start || sourceEvent.startTime || sourceEvent.startsAt);
    if (!externalEventId || !startDate) return null;

    const rawType = normalizeString(sourceEvent.type || sourceEvent.eventType).toLowerCase();
    const isPractice = rawType === 'practice';
    const toTimestamp = (date) => Timestamp?.fromDate ? Timestamp.fromDate(date) : date;
    const title = normalizeString(sourceEvent.title || sourceEvent.summary || (isPractice ? 'Practice' : ''));
    const opponent = normalizeString(sourceEvent.opponent || sourceEvent.awayTeam || sourceEvent.homeTeam || title || 'TBD');
    const endDate = toDate(sourceEvent.end || sourceEvent.endTime || sourceEvent.endsAt);

    const payload = {
        type: isPractice ? 'practice' : 'game',
        date: toTimestamp(startDate),
        location: normalizeString(sourceEvent.location || sourceEvent.venue) || null,
        notes: normalizeString(sourceEvent.notes || sourceEvent.description) || null,
        sourceMetadata: getEventSourceMetadata(sourceEvent, source)
    };

    if (endDate) payload.end = toTimestamp(endDate);
    if (normalizeString(sourceEvent.status)) payload.status = normalizeString(sourceEvent.status);

    if (isPractice) {
        payload.title = title || 'Practice';
        payload.opponent = null;
        payload.statTrackerConfigId = null;
    } else {
        payload.opponent = opponent || 'TBD';
        payload.title = title || null;
        if (typeof sourceEvent.isHome === 'boolean') payload.isHome = sourceEvent.isHome;
    }

    return payload;
}

export function buildRegistrationScheduleImportPreview({ sourceEvents = [], existingEvents = [], Timestamp, source = {} } = {}) {
    const sourceKey = getSourceKey(source);
    const existingByExternalId = new Map();
    (existingEvents || []).forEach((event) => {
        const externalEventId = getExistingExternalEventId(event);
        if (!externalEventId) return;
        existingByExternalId.set(getExternalEventKey(externalEventId, event.sourceMetadata || event.registrationSource || source), event);
        if (!event.sourceMetadata?.sourceType && !event.sourceMetadata?.sourceId && !event.registrationSource?.sourceType && !event.registrationSource?.sourceId) {
            existingByExternalId.set(getExternalEventKey(externalEventId, source), event);
        }
    });

    const seenExternalIds = new Set();
    return (sourceEvents || []).map((sourceEvent, index) => {
        const externalEventId = getExternalEventId(sourceEvent);
        const eventKey = getExternalEventKey(externalEventId, source);
        const payload = buildRegistrationScheduleEventPayload(sourceEvent, { Timestamp, source });
        if (!externalEventId || !payload) {
            return { index, sourceEvent, payload, externalEventId, action: 'skipped', selectable: false, reason: 'Missing source event id or date' };
        }
        if (seenExternalIds.has(eventKey)) {
            return { index, sourceEvent, payload, externalEventId, action: 'duplicate', selectable: false, reason: 'Duplicate source event in the registration snapshot' };
        }
        seenExternalIds.add(eventKey);

        const existing = existingByExternalId.get(eventKey);
        if (existing?.id) {
            const unchanged = isUnchangedImportedEvent(payload, existing);
            return {
                index,
                sourceEvent,
                payload,
                externalEventId,
                action: unchanged ? 'unchanged' : 'update',
                selectable: !unchanged,
                existingEventId: existing.id,
                reason: unchanged ? 'Already matches the imported event' : 'Matches an imported event with changes'
            };
        }

        const conflictingImportedEvent = (existingEvents || []).find((candidate) => {
            const candidateExternalEventId = getExistingExternalEventId(candidate);
            return candidateExternalEventId === externalEventId && getExistingSourceKey(candidate) !== sourceKey;
        });
        if (conflictingImportedEvent) {
            return { index, sourceEvent, payload, externalEventId, action: 'conflict', selectable: false, existingEventId: conflictingImportedEvent.id || null, reason: 'Source event id is already linked to a different registration source' };
        }

        const conflict = (existingEvents || []).find((candidate) => !getExistingExternalEventId(candidate) && isSameLocalEvent(sourceEvent, candidate));
        if (conflict) {
            return { index, sourceEvent, payload, externalEventId, action: 'conflict', selectable: false, existingEventId: conflict.id || null, reason: 'Likely duplicate: same date/time and opponent/title already exists' };
        }

        return { index, sourceEvent, payload, externalEventId, action: 'add', selectable: true, reason: 'Ready to import' };
    });
}

export function planRegistrationScheduleImport({ sourceEvents = [], existingEvents = [], Timestamp, source = {} } = {}) {
    const operations = [];
    const results = {
        added: 0,
        updated: 0,
        unchanged: 0,
        duplicates: 0,
        skipped: 0,
        conflicted: 0,
        conflicts: []
    };

    buildRegistrationScheduleImportPreview({ sourceEvents, existingEvents, Timestamp, source }).forEach((row) => {
        if (row.action === 'skipped') {
            results.skipped += 1;
            return;
        }
        if (row.action === 'duplicate') {
            results.duplicates += 1;
            return;
        }
        if (row.action === 'unchanged') {
            results.unchanged += 1;
            return;
        }
        if (row.action === 'conflict') {
            results.conflicted += 1;
            results.conflicts.push({ externalEventId: row.externalEventId, existingEventId: row.existingEventId || null });
            return;
        }
        if (row.action === 'update') {
            operations.push({ type: 'update', eventId: row.existingEventId, eventType: row.payload.type, payload: row.payload });
            results.updated += 1;
            return;
        }

        const addPayload = row.payload.type === 'game'
            ? { status: 'scheduled', homeScore: 0, awayScore: 0, ...row.payload }
            : row.payload;
        operations.push({ type: 'add', eventType: row.payload.type, payload: addPayload });
        results.added += 1;
    });

    return { operations, results };
}

export function formatRegistrationImportResults(results = {}) {
    return `${results.added || 0} added, ${results.updated || 0} updated, ${results.unchanged || 0} unchanged, ${results.duplicates || 0} duplicate, ${results.skipped || 0} skipped, ${results.conflicted || 0} conflicted`;
}
