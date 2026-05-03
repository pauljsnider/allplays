const SUPPORTED_REMINDER_HOURS = [24, 48, 72];

function coerceReminderHours(value, fallback = 24) {
    const parsed = Number.parseInt(value, 10);
    return SUPPORTED_REMINDER_HOURS.includes(parsed) ? parsed : fallback;
}

function eventTypeLabel(eventType) {
    return String(eventType || '').toLowerCase() === 'practice' ? 'Practice' : 'Game';
}

function coerceEventDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value?.toDate === 'function') {
        const date = value.toDate();
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function buildNextReminderAt(eventDate, reminderHours = 24) {
    const date = coerceEventDate(eventDate);
    if (!date) return null;
    const hours = coerceReminderHours(reminderHours, 24);
    return new Date(date.getTime() - hours * 60 * 60 * 1000).toISOString();
}

export function normalizeScheduleNotificationSettings(settings = {}) {
    return {
        enabled: settings?.enabled !== false,
        reminderHours: coerceReminderHours(settings?.reminderHours, 24),
        delivery: settings?.delivery === 'team_chat' ? 'team_chat' : 'team_chat'
    };
}

export function describeScheduleReminderWindow(settings = {}) {
    const hasTeamDefault = Object.prototype.hasOwnProperty.call(settings || {}, 'reminderHours')
        && SUPPORTED_REMINDER_HOURS.includes(Number.parseInt(settings?.reminderHours, 10));
    const { reminderHours } = normalizeScheduleNotificationSettings(settings);
    const label = `${reminderHours} hours before event start`;

    return hasTeamDefault
        ? `Team default reminder window: ${label}.`
        : `Fallback reminder window: ${label}. No team default is set yet.`;
}

export function buildScheduleNotificationMetadata({
    settings,
    reminderHours,
    action,
    sent = false,
    userId = null,
    note = null,
    eventDate = null
} = {}) {
    const normalized = normalizeScheduleNotificationSettings(settings);
    const effectiveReminderHours = coerceReminderHours(reminderHours, normalized.reminderHours);
    const nextReminderAt = normalized.enabled ? buildNextReminderAt(eventDate, effectiveReminderHours) : null;
    return {
        enabled: normalized.enabled,
        reminderHours: effectiveReminderHours,
        delivery: normalized.delivery,
        nextReminderAt,
        reminderStatus: nextReminderAt ? 'pending' : 'disabled',
        reminderSent: false,
        reminderSentAt: null,
        sent,
        sentAt: sent ? new Date().toISOString() : null,
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

export function buildScheduleNotificationTargets({
    teamId,
    title,
    counterpartTeamId,
    counterpartTitle
} = {}) {
    const targets = [];
    const seen = new Set();

    function addTarget(nextTeamId, nextTitle) {
        const normalizedTeamId = String(nextTeamId || '').trim();
        if (!normalizedTeamId || seen.has(normalizedTeamId)) return;
        seen.add(normalizedTeamId);
        targets.push({
            teamId: normalizedTeamId,
            title: nextTitle || title || 'Untitled event'
        });
    }

    addTarget(teamId, title);
    addTarget(counterpartTeamId, counterpartTitle || title);

    return targets;
}

export async function postScheduleNotificationTargets({
    targets = [],
    postChatMessage,
    senderId,
    senderName,
    senderEmail,
    buildText
} = {}) {
    const failures = [];
    let sentCount = 0;

    for (const target of targets) {
        try {
            await postChatMessage(target.teamId, {
                text: buildText(target),
                senderId,
                senderName,
                senderEmail
            });
            sentCount += 1;
        } catch (error) {
            failures.push({
                teamId: target.teamId,
                message: error?.message || 'Unknown chat notification error'
            });
        }
    }

    return {
        sent: sentCount > 0,
        sentCount,
        failedCount: failures.length,
        failures,
        errorMessage: failures.map(({ message }) => message).join('; ')
    };
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
