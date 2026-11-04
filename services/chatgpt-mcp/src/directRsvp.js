import { DomainError } from './core.js';
import { ID, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { createTeamProposalStore } from './directTeamProposalStore.js';
import { ordinaryScheduleEvent, scheduleSummary } from './scheduleReview.js';

const TOOL = 'mcp_direct_staff_rsvp';
const responses = ['going', 'maybe', 'not_going'];
const privateFields = ['note', 'notes', 'adminNote', 'adminOnlyNote', 'privateNote', 'availabilityNote', 'privateAvailabilityNote'];
const basePath = (args) => `teams/${args.teamId}/games/${args.eventId}`;
const responsePath = (args, uid) => `${basePath(args)}/rsvps/${uid}__${args.playerId}`;

// Matches the app's availability-preferences normalization. Keep the parity
// regression against that shared browser module; the service deploy is standalone.
export function rsvpCutoffAt(eventDate, raw = {}) {
    const source = raw?.availabilityPreferences && typeof raw.availabilityPreferences === 'object' ? raw.availabilityPreferences : raw;
    const value = Number(source?.cutoffMinutesBeforeStart ?? source?.cutoffMinutes ?? 0);
    const minutes = Number.isFinite(value) ? Math.max(0, Math.min(10080, Math.round(value))) : 0;
    return minutes > 0 ? eventDate.getTime() - minutes * 60000 : null;
}
export function createDirectRsvpStore(options) {
    const event = /^teams\/[A-Za-z0-9_-]{1,128}\/games\/[A-Za-z0-9_-]{1,128}$/;
    const own = new RegExp(`^teams/[A-Za-z0-9_-]{1,128}/games/[A-Za-z0-9_-]{1,128}/rsvps/${options.uid}__[A-Za-z0-9_-]{1,128}$`);
    const base = new RegExp(`^teams/[A-Za-z0-9_-]{1,128}/games/[A-Za-z0-9_-]{1,128}/rsvps/${options.uid}$`);
    return createTeamProposalStore(options, { toolName: TOOL, receiptFields: ['teamId', 'eventId', 'playerId'], policy: {
        read: (path) => own.test(path) || base.test(path) || event.test(path) || /^teams\/[A-Za-z0-9_-]{1,128}(\/players\/[A-Za-z0-9_-]{1,128})?$/.test(path),
        write: (path) => own.test(path),
        patch: (path, data) => own.test(path) && responses.includes(data.response) && data.respondedAt instanceof Date
            && Object.keys(data).every((key) => ['response', 'respondedAt'].includes(key))
    } });
}
export function createDirectRsvpCommands(dependencies) {
    const { uid, now = Date.now } = dependencies;
    const assertOpen = ({ team, event }) => {
        const cutoff = rsvpCutoffAt(event.data.date, team.data.availabilityPreferences);
        if (cutoff !== null && now() >= cutoff) throw new DomainError('availability_locked', 'Availability is locked. Use the app; no cutoff bypass is provided.');
    };
    return createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ teamId, eventId, playerId, response }) => {
            if (![teamId, eventId, playerId].every((id) => ID.test(id || '')) || !responses.includes(response)) throw new DomainError('invalid_argument', 'Use exact team/event/player IDs and going, maybe or not_going.');
            return { teamId, eventId, playerId, response };
        },
        validateReceipt: (record) => [record.teamId, record.eventId, record.playerId].every((id) => ID.test(id || '')),
        authorize: (context, actor, args) => validateManager(context, actor, args.teamId),
        result: ({ teamId, eventId, playerId }) => ({ teamId, eventId, playerId, scope: 'current_manager_player_override',
            summaryRefresh: 'not_performed', message: 'Outcome refers only to this manager’s player-specific RSVP record. Other responses and cached aggregate totals are not rewritten; no messages are sent.' }),
        readTarget: async (reader, args) => {
            const team = await reader.get(`teams/${args.teamId}`);
            const event = await reader.get(basePath(args));
            const player = await reader.get(`teams/${args.teamId}/players/${args.playerId}`);
            if (!team.exists || !team.version || !ordinaryScheduleEvent(event.data)) throw new DomainError('unsupported_event', 'Choose an ordinary scheduled event. Recurring, imported, cancelled or active events require app review.');
            if (!player.exists || player.data.active === false) throw new DomainError('not_found', 'Choose an existing active player by exact ID.');
            const target = await reader.get(responsePath(args, uid));
            const legacy = await reader.get(`${basePath(args)}/rsvps/${uid}`);
            // Never delete or reinterpret a family/base response: base RSVP state
            // participates in confirmed-member access rules as well as availability.
            if (legacy.exists) throw new DomainError('legacy_rsvp', 'This account has a base/family RSVP. Use app review for reconciliation; this tool cannot remove or change it.');
            if (target.exists && (target.data.userId !== uid || target.data.playerId !== args.playerId || target.data.childId !== args.playerId
                || !Array.isArray(target.data.playerIds) || target.data.playerIds.length !== 1 || target.data.playerIds[0] !== args.playerId
                || !responses.includes(target.data.response) || privateFields.some((key) => key in target.data))) throw new DomainError('unsupported_rsvp', 'The existing RSVP has a legacy or inconsistent shape. Use app review.');
            const result = { team, event, player, target, legacy }; assertOpen(result); return result;
        },
        revisions: ({ team, event, player, target, legacy }) => ({ team: team.version, event: event.version, player: player.version, rsvp: target.version, legacy: legacy.version }),
        preview: ({ team, event, player, target }, args) => ({ action: 'Save one manager RSVP override', teamId: args.teamId, teamName: String(team.data.name || args.teamId),
            event: scheduleSummary(args.eventId, event.data), playerId: args.playerId, playerName: String(player.data.name || args.playerId),
            actorId: uid, previousOwnOverride: target.exists ? target.data.response : null, requestedResponse: args.response,
            effect: 'This manager override becomes visible to the team and may supersede other responses. Existing private notes, other responders, base/family RSVPs and access grants are untouched. No messages are sent. Cached aggregate totals are not refreshed by this prototype.' }),
        beforeCommit: assertOpen,
        apply: (transaction, { target }, args) => {
            const patch = { response: args.response, respondedAt: new Date(now()) };
            if (target.exists) transaction.patch(responsePath(args, uid), patch);
            else transaction.set(responsePath(args, uid), { userId: uid, displayName: null, playerId: args.playerId, childId: args.playerId, playerIds: [args.playerId], ...patch });
        }
    });
}
