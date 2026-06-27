function toDate(value) {
    if (value instanceof Date) return value;
    if (typeof value?.toDate === 'function') return value.toDate();
    return new Date(value);
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
            .filter(Boolean)
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

        const mappedEvent = buildGlobalCalendarIcsEvent({
            team,
            teamColor,
            event: {
                ...event,
                dtstart: eventDate
            }
        });
        if (!mappedEvent) return;

        const trackingId = String(mappedEvent?.id || '').trim();
        if (trackingId && importedTrackingIds.has(trackingId)) return;

        if (trackingId) {
            importedTrackingIds.add(trackingId);
        }
        mergedEvents.push(mappedEvent);
    });

    return mergedEvents;
}
