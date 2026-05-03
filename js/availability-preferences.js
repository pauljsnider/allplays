const DEFAULT_AVAILABILITY_PREFERENCES = Object.freeze({
    cutoffMinutesBeforeStart: 0,
    noteVisibility: 'admins'
});

export function normalizeAvailabilityPreferences(raw = {}) {
    const source = raw?.availabilityPreferences && typeof raw.availabilityPreferences === 'object'
        ? raw.availabilityPreferences
        : raw;
    const cutoffValue = Number(source?.cutoffMinutesBeforeStart ?? source?.cutoffMinutes ?? 0);
    const cutoffMinutesBeforeStart = Number.isFinite(cutoffValue)
        ? Math.max(0, Math.min(10080, Math.round(cutoffValue)))
        : DEFAULT_AVAILABILITY_PREFERENCES.cutoffMinutesBeforeStart;
    const noteVisibility = source?.noteVisibility === 'team' ? 'team' : DEFAULT_AVAILABILITY_PREFERENCES.noteVisibility;
    return {
        cutoffMinutesBeforeStart,
        noteVisibility
    };
}

export function isAvailabilityLocked(eventDate, preferences = {}, now = new Date()) {
    const normalized = normalizeAvailabilityPreferences(preferences);
    if (normalized.cutoffMinutesBeforeStart <= 0) return false;
    const start = eventDate instanceof Date ? eventDate : new Date(eventDate);
    const current = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(start.getTime()) || Number.isNaN(current.getTime())) return false;
    return current.getTime() >= start.getTime() - normalized.cutoffMinutesBeforeStart * 60 * 1000;
}

export function canViewAvailabilityNotes(preferences = {}, isTeamAdmin = false) {
    const normalized = normalizeAvailabilityPreferences(preferences);
    return normalized.noteVisibility === 'team' || !!isTeamAdmin;
}

export function buildAvailabilityNoteRows(rsvps = [], preferences = {}, isTeamAdmin = false) {
    if (!canViewAvailabilityNotes(preferences, isTeamAdmin)) return [];
    return (Array.isArray(rsvps) ? rsvps : [])
        .map((rsvp) => ({
            displayName: String(rsvp?.displayName || 'Team member').trim() || 'Team member',
            response: rsvp?.response || 'not_responded',
            note: String(rsvp?.note || '').trim()
        }))
        .filter((row) => row.note);
}

export function formatAvailabilityCutoff(preferences = {}) {
    const { cutoffMinutesBeforeStart } = normalizeAvailabilityPreferences(preferences);
    if (cutoffMinutesBeforeStart <= 0) return 'No cutoff';
    if (cutoffMinutesBeforeStart % 1440 === 0) {
        const days = cutoffMinutesBeforeStart / 1440;
        return `${days} day${days === 1 ? '' : 's'} before start`;
    }
    if (cutoffMinutesBeforeStart % 60 === 0) {
        const hours = cutoffMinutesBeforeStart / 60;
        return `${hours} hour${hours === 1 ? '' : 's'} before start`;
    }
    return `${cutoffMinutesBeforeStart} minutes before start`;
}
