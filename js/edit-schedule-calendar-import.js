export function validateCalendarImportUrl(url) {
    const trimmedUrl = String(url || '').trim();
    if (!trimmedUrl) {
        return {
            isValid: false,
            message: 'Please enter a calendar URL'
        };
    }

    if (!trimmedUrl.includes('.ics')) {
        return {
            isValid: false,
            message: 'Please enter a valid .ics calendar URL (must include .ics)'
        };
    }

    return {
        isValid: true,
        normalizedUrl: trimmedUrl
    };
}

function toDate(value) {
    if (value instanceof Date) return value;
    if (typeof value?.toDate === 'function') return value.toDate();
    if (!value) return null;
    return new Date(value);
}

export function mergeCalendarImportEvents({
    calendarEvents,
    dbEvents,
    trackedUids,
    currentTeamName,
    isTrackedCalendarEvent,
    getCalendarEventStatus,
    isPracticeEvent,
    extractOpponent
}) {
    const importedEvents = [];

    (calendarEvents || []).forEach((event) => {
        if (isTrackedCalendarEvent(event, trackedUids)) return;

        const eventDate = event?.dtstart instanceof Date ? event.dtstart : new Date(event?.dtstart);
        if (Number.isNaN(eventDate.getTime())) return;

        const hasConflict = (dbEvents || []).some((dbEvent) => {
            const dbDate = toDate(dbEvent?.date);
            if (!(dbDate instanceof Date) || Number.isNaN(dbDate.getTime())) return false;
            return Math.abs(dbDate - eventDate) < 60000;
        });
        if (hasConflict) return;

        const isPractice = isPracticeEvent(event.summary);
        const cleanSummary = event.summary?.replace(/\[(?:CANCELED|CANCELLED)\]\s*/gi, '') || '';

        importedEvents.push({
            source: 'calendar',
            eventType: isPractice ? 'practice' : 'game',
            date: eventDate,
            end: toDate(event?.dtend),
            opponent: extractOpponent(cleanSummary, currentTeamName),
            location: event.location || 'TBD',
            isPractice,
            isCancelled: getCalendarEventStatus(event) === 'cancelled',
            calendarEvent: event
        });
    });

    return importedEvents;
}
