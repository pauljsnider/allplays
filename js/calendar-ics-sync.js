function toDate(value) {
    if (value instanceof Date) return value;
    if (typeof value?.toDate === 'function') return value.toDate();
    return new Date(value);
}

function getRealIcsTrackingId(event) {
    const occurrenceId = typeof event?.id === 'string' ? event.id.trim() : '';
    if (occurrenceId) return occurrenceId;

    const uid = typeof event?.uid === 'string' ? event.uid.trim() : '';
    return uid;
}

function isGeneratedIcsFallbackId(value) {
    return /^ics-\d+$/.test(String(value || '').trim());
}

export function mergeGlobalCalendarIcsEvents({
    team,
    teamColor,
    existingEvents,
    icsEvents,
    trackedUids,
    isTrackedCalendarEvent,
    buildGlobalCalendarIcsEvent
}) {
    const mergedEvents = [];
    const importedTrackingIds = new Set(
        (existingEvents || [])
            .filter((existingEvent) => existingEvent?.source === 'ics' && existingEvent?.teamId === team?.id)
            .map((existingEvent) => String(existingEvent?.id || '').trim())
            .filter((trackingId) => trackingId && !isGeneratedIcsFallbackId(trackingId))
    );

    (icsEvents || []).forEach((event) => {
        if (isTrackedCalendarEvent(event, trackedUids)) return;

        const eventDate = toDate(event?.dtstart);
        if (Number.isNaN(eventDate.getTime())) return;

        const hasTrackedConflict = (existingEvents || []).some((existingEvent) => {
            if (existingEvent?.source !== 'db') return false;
            if (existingEvent?.teamId !== team?.id) return false;
            return Boolean(event?.uid && existingEvent?.calendarEventUid === event.uid);
        });
        if (hasTrackedConflict) return;

        const realTrackingId = getRealIcsTrackingId(event);
        if (realTrackingId && importedTrackingIds.has(realTrackingId)) return;

        const mappedEvent = buildGlobalCalendarIcsEvent({
            team,
            teamColor,
            event: {
                ...event,
                dtstart: eventDate
            }
        });
        if (!mappedEvent) return;

        if (realTrackingId) {
            importedTrackingIds.add(realTrackingId);
        }
        mergedEvents.push(mappedEvent);
    });

    return mergedEvents;
}
