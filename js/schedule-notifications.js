const SUPPORTED_REMINDER_HOURS = [24, 48, 72];

function coerceReminderHours(value, fallback = 24) {
    const parsed = Number.parseInt(value, 10);
    return SUPPORTED_REMINDER_HOURS.includes(parsed) ? parsed : fallback;
}

function eventTypeLabel(eventType) {
    return String(eventType || '').toLowerCase() === 'practice' ? 'Practice' : 'Game';
}

export function normalizeScheduleNotificationSettings(settings = {}) {
    return {
        enabled: settings?.enabled !== false,
        reminderHours: coerceReminderHours(settings?.reminderHours, 24),
        delivery: settings?.delivery === 'team_chat' ? 'team_chat' : 'team_chat'
    };
}

export function buildScheduleNotificationMetadata({
    settings,
    reminderHours,
    action,
    sent = false,
    userId = null,
    note = null
} = {}) {
    const normalized = normalizeScheduleNotificationSettings(settings);
    return {
        enabled: normalized.enabled,
        reminderHours: coerceReminderHours(reminderHours, normalized.reminderHours),
        delivery: normalized.delivery,
        lastAction: action || null,
        lastSentAt: sent ? new Date().toISOString() : null,
        lastSentBy: sent ? (userId || null) : null,
        lastNote: note ? String(note).trim() : null
    };
}

export function buildScheduleChangeMessage({
    action,
    eventType,
    title,
    dateLabel,
    location,
    note
} = {}) {
    const verb = action === 'created'
        ? 'created'
        : action === 'cancelled'
            ? 'cancelled'
            : 'updated';

    const lines = [
        `Schedule update: ${eventTypeLabel(eventType)} ${verb}`,
        `${eventTypeLabel(eventType)}: ${title || 'Untitled event'}`
    ];

    if (dateLabel) lines.push(`When: ${dateLabel}`);
    if (location) lines.push(`Where: ${location}`);
    if (note) lines.push(`Coach note: ${String(note).trim()}`);

    return lines.join('\n');
}

export function buildRsvpReminderMessage({
    eventType,
    title,
    dateLabel,
    missingCount,
    note
} = {}) {
    const lines = [
        `RSVP reminder: ${eventTypeLabel(eventType)}`,
        `${eventTypeLabel(eventType)}: ${title || 'Untitled event'}`
    ];

    if (dateLabel) lines.push(`When: ${dateLabel}`);
    lines.push(`${Number.parseInt(missingCount, 10) || 0} player(s) still have not responded.`);
    if (note) lines.push(`Coach note: ${String(note).trim()}`);

    return lines.join('\n');
}

export function getSupportedReminderHours() {
    return [...SUPPORTED_REMINDER_HOURS];
}
