import { normalizeOfficiatingSlots } from './officiating-utils.js?v=1';

function normalizeId(value) {
    return String(value || '').trim();
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function toDateMillis(value) {
    if (!value) return null;
    const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    const millis = date.getTime();
    return Number.isFinite(millis) ? millis : null;
}

export function normalizeOfficiatingNotificationActor(actor = {}) {
    return {
        userId: normalizeId(actor.userId || actor.uid),
        name: normalizeId(actor.name || actor.displayName),
        email: normalizeEmail(actor.email)
    };
}

export function buildOfficiatingGameReference({ teamId, gameId, game = {} } = {}) {
    return {
        teamId: normalizeId(teamId),
        gameId: normalizeId(gameId || game.id),
        opponent: normalizeId(game.opponent) || null,
        location: normalizeId(game.location) || null,
        date: game.date || null
    };
}

export function buildOfficiatingNotificationRecord({
    teamId,
    gameId,
    game = {},
    slot = {},
    event,
    status,
    recipientType = 'official',
    actor = {},
    timestamp = null
} = {}) {
    const normalizedSlot = normalizeOfficiatingSlots([slot])[0] || slot;
    const normalizedActor = normalizeOfficiatingNotificationActor(actor);

    return {
        type: 'officiating_assignment',
        assignmentType: normalizedSlot.position || null,
        event,
        gameReference: buildOfficiatingGameReference({ teamId, gameId, game }),
        gameId: normalizeId(gameId || game.id),
        slotId: normalizedSlot.id || null,
        position: normalizedSlot.position || null,
        status: status || normalizedSlot.status || null,
        timestamp,
        actor: normalizedActor,
        actorUserId: normalizedActor.userId || null,
        actorEmail: normalizedActor.email || null,
        recipientType,
        recipientOfficialId: normalizedSlot.officialId || null,
        recipientOfficialUserId: normalizedSlot.officialUserId || null,
        recipientOfficialName: normalizedSlot.officialName || null,
        recipientOfficialEmail: normalizedSlot.officialEmail || null,
        read: false
    };
}

function isSameOfficial(previousSlot = {}, nextSlot = {}) {
    return !!(
        (previousSlot.officialUserId && previousSlot.officialUserId === nextSlot.officialUserId) ||
        (previousSlot.officialEmail && previousSlot.officialEmail === nextSlot.officialEmail) ||
        (previousSlot.officialId && previousSlot.officialId === nextSlot.officialId)
    );
}

function hasAssignedOfficial(slot = {}) {
    return !!(slot.officialId || slot.officialUserId || slot.officialEmail || slot.officialName);
}

export function buildOfficiatingAssignmentNotificationRecords({
    teamId,
    gameId,
    previousGame = null,
    nextGame = {},
    actor = {},
    timestamp = null
} = {}) {
    const nextSlots = normalizeOfficiatingSlots(nextGame.officiatingSlots || []);
    const previousSlots = normalizeOfficiatingSlots(previousGame?.officiatingSlots || []);
    const previousById = new Map(previousSlots.map((slot) => [slot.id, slot]));
    const previousDateMillis = toDateMillis(previousGame?.date);
    const nextDateMillis = toDateMillis(nextGame.date);
    const wasRescheduled = previousGame && previousDateMillis !== null && nextDateMillis !== null && previousDateMillis !== nextDateMillis;

    return nextSlots.flatMap((slot) => {
        if (!hasAssignedOfficial(slot)) return [];

        const previousSlot = previousById.get(slot.id);
        const records = [];
        if (!previousSlot || !isSameOfficial(previousSlot, slot)) {
            records.push(buildOfficiatingNotificationRecord({
                teamId,
                gameId,
                game: nextGame,
                slot,
                event: 'assigned',
                status: slot.status,
                recipientType: 'official',
                actor,
                timestamp
            }));
        } else if (wasRescheduled) {
            records.push(buildOfficiatingNotificationRecord({
                teamId,
                gameId,
                game: nextGame,
                slot,
                event: 'rescheduled',
                status: slot.status,
                recipientType: 'official',
                actor,
                timestamp
            }));
        }

        return records;
    });
}
