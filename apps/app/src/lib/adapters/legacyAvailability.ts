import {
    buildAvailabilityNoteRows as legacyBuildAvailabilityNoteRows,
    canViewAvailabilityNotes as legacyCanViewAvailabilityNotes,
    formatAvailabilityCutoff as legacyFormatAvailabilityCutoff,
    isAvailabilityLocked as legacyIsAvailabilityLocked,
    normalizeAvailabilityPreferences as legacyNormalizeAvailabilityPreferences
} from '@legacy/availability-preferences.js';

export type LegacyAvailabilityPreferences = Record<string, unknown> & {
    noteVisibility?: string | null;
};

export function normalizeAvailabilityPreferences(value: unknown): LegacyAvailabilityPreferences {
    const normalized = legacyNormalizeAvailabilityPreferences(value);
    return normalized && typeof normalized === 'object' ? normalized as LegacyAvailabilityPreferences : {};
}

export function buildAvailabilityNoteRows(rsvps: unknown[], preferences: unknown, isAdmin: boolean) {
    return legacyBuildAvailabilityNoteRows(Array.isArray(rsvps) ? rsvps : [], normalizeAvailabilityPreferences(preferences), isAdmin);
}

export function canViewAvailabilityNotes(preferences: unknown, isAdmin: boolean) {
    return legacyCanViewAvailabilityNotes(normalizeAvailabilityPreferences(preferences), isAdmin);
}

export function formatAvailabilityCutoff(preferences: unknown) {
    return legacyFormatAvailabilityCutoff(normalizeAvailabilityPreferences(preferences));
}

export function isAvailabilityLocked(date: unknown, preferences: unknown) {
    return legacyIsAvailabilityLocked(date, normalizeAvailabilityPreferences(preferences));
}
