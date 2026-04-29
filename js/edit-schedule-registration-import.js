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
    const title = normalizeString(sourceEvent.title || sourceEvent.summary || (isPractice ? 'Practice' : 'Game'));
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
        payload.isHome = typeof sourceEvent.isHome === 'boolean' ? sourceEvent.isHome : null;
    }

    return payload;
}

export function planRegistrationScheduleImport({ sourceEvents = [], existingEvents = [], Timestamp, source = {} } = {}) {
    const existingByExternalId = new Map();
    (existingEvents || []).forEach((event) => {
        const externalEventId = getExistingExternalEventId(event);
        if (externalEventId) existingByExternalId.set(externalEventId, event);
    });

    const seenExternalIds = new Set();
    const operations = [];
    const results = {
        added: 0,
        updated: 0,
        skipped: 0,
        conflicted: 0,
        conflicts: []
    };

    (sourceEvents || []).forEach((sourceEvent) => {
        const externalEventId = getExternalEventId(sourceEvent);
        if (!externalEventId || seenExternalIds.has(externalEventId)) {
            results.skipped += 1;
            return;
        }
        seenExternalIds.add(externalEventId);

        const payload = buildRegistrationScheduleEventPayload(sourceEvent, { Timestamp, source });
        if (!payload) {
            results.skipped += 1;
            return;
        }

        const existing = existingByExternalId.get(externalEventId);
        if (existing?.id) {
            operations.push({ type: 'update', eventId: existing.id, eventType: payload.type, payload });
            results.updated += 1;
            return;
        }

        const conflict = (existingEvents || []).find((candidate) => !getExistingExternalEventId(candidate) && isSameLocalEvent(sourceEvent, candidate));
        if (conflict) {
            results.conflicted += 1;
            results.conflicts.push({ externalEventId, existingEventId: conflict.id || null });
            return;
        }

        const addPayload = payload.type === 'game'
            ? { status: 'scheduled', homeScore: 0, awayScore: 0, ...payload }
            : payload;
        operations.push({ type: 'add', eventType: payload.type, payload: addPayload });
        results.added += 1;
    });

    return { operations, results };
}

export function formatRegistrationImportResults(results = {}) {
    return `${results.added || 0} added, ${results.updated || 0} updated, ${results.skipped || 0} skipped, ${results.conflicted || 0} conflicted`;
}
