import { getPrimaryAppCheckHeaders } from './firebase-app-check-rest.js?v=1';

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
    eventDate = null,
    cancelled = false,
    canceled = false
} = {}) {
    const normalized = normalizeScheduleNotificationSettings(settings);
    const effectiveReminderHours = coerceReminderHours(reminderHours, normalized.reminderHours);
    const isCanceled = cancelled || canceled || action === 'cancelled' || action === 'canceled' || action === 'deleted';
    const nextReminderAt = normalized.enabled && !isCanceled ? buildNextReminderAt(eventDate, effectiveReminderHours) : null;
    const reminderStatus = isCanceled
        ? 'canceled'
        : nextReminderAt
            ? 'pending'
            : 'disabled';
    const sentAt = sent ? new Date().toISOString() : null;
    const canceledAt = isCanceled ? new Date().toISOString() : null;
    return {
        enabled: normalized.enabled,
        reminderHours: effectiveReminderHours,
        delivery: normalized.delivery,
        nextReminderAt,
        reminderStatus,
        reminderSent: false,
        reminderSentAt: null,
        reminderCanceled: isCanceled,
        reminderCanceledAt: canceledAt,
        reminderCanceledBy: isCanceled ? (userId || null) : null,
        sent,
        sentAt,
        lastAction: action || null,
        lastSentAt: sentAt,
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

function uniqueNonEmptyStrings(values) {
    return Array.from(new Set((Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)));
}

function uniqueEligibleEmails(values) {
    return uniqueNonEmptyStrings(values)
        .filter((email) => email.includes('@'));
}

function normalizeRsvpResponse(response) {
    return ['going', 'maybe', 'not_going'].includes(response) ? response : 'not_responded';
}

function getRsvpPlayerIds(rsvp) {
    const directIds = uniqueNonEmptyStrings(rsvp?.playerIds);
    if (directIds.length) return directIds;
    return uniqueNonEmptyStrings([rsvp?.playerId, rsvp?.childId]);
}

function getPlayerRosterParents(player) {
    const privateParents = Array.isArray(player?.privateProfileParents) ? player.privateProfileParents : [];
    if (privateParents.length > 0) return privateParents;
    return Array.isArray(player?.parents) ? player.parents : [];
}

function getPlayerParentUserIds(player) {
    return uniqueNonEmptyStrings([
        ...getPlayerRosterParents(player).map((parent) => parent?.userId),
        player?.parentUserId,
        player?.guardianUserId
    ]);
}

function getNonRespondingAvailabilityPlayers(players, rsvps) {
    const activePlayers = (Array.isArray(players) ? players : [])
        .filter((player) => player?.active !== false && String(player?.id || '').trim());
    const playerIdsByParentUserId = new Map();
    activePlayers.forEach((player) => {
        getPlayerParentUserIds(player).forEach((userId) => {
            const existing = playerIdsByParentUserId.get(userId) || [];
            existing.push(String(player.id));
            playerIdsByParentUserId.set(userId, existing);
        });
    });
    const respondedPlayerIds = new Set();

    (Array.isArray(rsvps) ? rsvps : []).forEach((rsvp) => {
        if (normalizeRsvpResponse(rsvp?.response) === 'not_responded') return;
        const rsvpPlayerIds = getRsvpPlayerIds(rsvp);
        const fallbackPlayerIds = rsvpPlayerIds.length ? [] : (playerIdsByParentUserId.get(String(rsvp?.userId || '').trim()) || []);
        [...rsvpPlayerIds, ...fallbackPlayerIds].forEach((playerId) => respondedPlayerIds.add(playerId));
    });

    return activePlayers.filter((player) => !respondedPlayerIds.has(String(player.id)));
}

export function buildAvailabilityReminderRecipients(players, rsvps) {
    const nonRespondingPlayers = getNonRespondingAvailabilityPlayers(players, rsvps);
    const playerIds = uniqueNonEmptyStrings(nonRespondingPlayers.map((player) => player.id));
    const parentIds = uniqueNonEmptyStrings(nonRespondingPlayers.flatMap((player) => (
        getPlayerParentUserIds(player)
    )));
    const parentEmails = uniqueNonEmptyStrings(nonRespondingPlayers.flatMap((player) => (
        getPlayerRosterParents(player).map((parent) => parent?.email)
    )));
    const rosterDirectRecipientCount = playerIds.filter((playerId) => {
        const player = nonRespondingPlayers.find((candidate) => String(candidate.id) === playerId);
        return getPlayerRosterParents(player).length === 0;
    }).length;

    return {
        playerIds,
        parentIds,
        parentEmails,
        playerCount: playerIds.length,
        recipientCount: parentIds.length + rosterDirectRecipientCount
    };
}

export function buildAvailabilityReminderEmailPreview(players, rsvps, notRespondedIds = null) {
    const nonRespondingPlayers = notRespondedIds
        ? (Array.isArray(players) ? players : []).filter(
            (p) => p?.active !== false && notRespondedIds.has(String(p?.id || ''))
          )
        : getNonRespondingAvailabilityPlayers(players, rsvps);
    const playerPreviews = nonRespondingPlayers.map((player) => {
        const parentEmails = uniqueEligibleEmails(
            getPlayerRosterParents(player).map((parent) => parent?.email)
        );
        return {
            playerId: String(player.id),
            playerName: player.name || `#${player.number || ''}`.trim() || 'Unknown Player',
            playerNumber: player.number || '',
            parentEmails,
            hasEligibleParentEmail: parentEmails.length > 0
        };
    });
    const eligibleEmails = uniqueEligibleEmails(playerPreviews.flatMap((player) => player.parentEmails));

    return {
        players: playerPreviews,
        eligibleEmails,
        eligibleEmailCount: eligibleEmails.length,
        missingEmailPlayerIds: playerPreviews
            .filter((player) => !player.hasEligibleParentEmail)
            .map((player) => player.playerId)
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

function getFunctionsBaseUrl(auth) {
    const configured = globalThis.window?.__ALLPLAYS_CONFIG__?.functionsBaseUrl || globalThis.window?.__ALLPLAYS_CONFIG__?.functions?.baseUrl;
    if (configured) return String(configured).replace(/\/$/, '');

    const projectId = auth?.app?.options?.projectId;
    if (!projectId) {
        throw new Error('Firebase project ID is not configured.');
    }
    return `https://us-central1-${projectId}.cloudfunctions.net`;
}

export async function sendPublicRsvpReminderEmails({
    auth,
    teamId,
    gameId,
    eventType,
    eventTitle,
    eventDate
} = {}) {
    const user = auth?.currentUser;
    if (!user) {
        throw new Error('Sign in before sending RSVP email reminders.');
    }

    const token = await user.getIdToken();
    const requestUrl = `${getFunctionsBaseUrl(auth)}/sendPublicRsvpEmails`;
    let response;
    try {
        response = await fetch(requestUrl, {
            method: 'POST',
            headers: await getPrimaryAppCheckHeaders({
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }, requestUrl),
            body: JSON.stringify({
                teamId,
                gameId,
                eventType,
                eventTitle,
                eventDate: eventDate instanceof Date ? eventDate.toISOString() : eventDate || null
            })
        });
    } catch (networkError) {
        // A blocked CORS request or offline network surfaces as a bare
        // TypeError: Failed to fetch. Give the coach something actionable.
        throw new Error('Could not reach the reminder service. Check your connection and try again.');
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || 'Unable to send RSVP email reminders.');
    }
    return payload;
}

export function getSupportedReminderHours() {
    return [...SUPPORTED_REMINDER_HOURS];
}
