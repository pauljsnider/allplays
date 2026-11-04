import { DomainError } from './core.js';
import { ID, createRevisionCommands } from './directRevisionCommand.js';
import { createDirectCommandStore } from './directCommandStore.js';
import { ordinaryScheduleEvent, scheduleSummary } from './scheduleReview.js';
import { rsvpCutoffAt } from './directRsvp.js';

const TOOL = 'mcp_direct_family_rsvp';
const responses = ['going', 'maybe', 'not_going'];
const basePath = ({ teamId, eventId }) => `teams/${teamId}/games/${eventId}`;
const childPath = (args, uid, id) => `${basePath(args)}/rsvps/${uid}__${id}`;
const safeId = (id) => typeof id === 'string' && ID.test(id);
const text = (value, max) => typeof value === 'string' && value === value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
function assertLinks(profile, args) {
    if (!profile.exists || !profile.version || !Array.isArray(profile.data.parentTeamIds) || !profile.data.parentTeamIds.includes(args.teamId)
        || !Array.isArray(profile.data.parentPlayerKeys) || args.playerIds.some((id) => !profile.data.parentPlayerKeys.includes(`${args.teamId}::${id}`))) {
        throw new DomainError('permission_denied', 'Every selected child must have a current exact team/player link for this account. Legacy-only or another household’s links require app review.');
    }
}
function assertCanonicalResponse(row, uid, playerId) {
    if (!row.exists) return;
    const data = row.data;
    if (!row.version || !data || Object.keys(data).some((key) => !['userId', 'displayName', 'playerIds', 'playerId', 'childId', 'response', 'respondedAt'].includes(key))
        || data.userId !== uid || data.playerId !== playerId || data.childId !== playerId || !Array.isArray(data.playerIds) || data.playerIds.length !== 1 || data.playerIds[0] !== playerId
        || !responses.includes(data.response) || !(data.displayName === null || text(data.displayName, 120))
        || !(data.respondedAt instanceof Date) || !Number.isFinite(data.respondedAt.getTime())) {
        throw new DomainError('unsupported_rsvp', 'An existing response is legacy, inconsistent or contains extra fields. Use app review; no data will be discarded.');
    }
}
export function createDirectFamilyRsvpStore(options) {
    const event = /^teams\/[A-Za-z0-9_-]{1,128}\/games\/[A-Za-z0-9_-]{1,128}$/;
    const own = new RegExp(`^teams/[A-Za-z0-9_-]{1,128}/games/[A-Za-z0-9_-]{1,128}/rsvps/${options.uid}__[A-Za-z0-9_-]{1,128}$`);
    const legacy = new RegExp(`^teams/[A-Za-z0-9_-]{1,128}/games/[A-Za-z0-9_-]{1,128}/rsvps/${options.uid}$`);
    const base = createDirectCommandStore(options, {
        read: (path) => path === `users/${options.uid}` || event.test(path) || own.test(path) || legacy.test(path) || /^teams\/[A-Za-z0-9_-]{1,128}(\/players\/[A-Za-z0-9_-]{1,128})?$/.test(path),
        write: (path) => own.test(path),
        patch: (path, data) => own.test(path) && Object.keys(data).sort().join(',') === 'respondedAt,response' && responses.includes(data.response) && data.respondedAt instanceof Date
    });
    const proposal = new RegExp(`^users/${options.uid}/privateAiPendingActions/direct_[a-f0-9-]{36}$`);
    return { ...base, transaction: (callback, settings) => base.transaction((tx) => callback({ ...tx, set: (path, record) => {
        if (!proposal.test(path)) return tx.set(path, record);
        if (record.userId !== options.uid || record.toolName !== TOOL || record.status !== 'completed') throw new DomainError('invalid_argument', 'Only this actor’s completed family-response receipt may be saved.');
        const { userId, toolName, teamId, eventId, playerIds, digest, status, completedAt } = record;
        tx.set(path, { userId, toolName, teamId, eventId, playerIds, digest, status, completedAt, receiptOnly: true });
    } }), settings) };
}
export function createDirectFamilyRsvpCommands(dependencies) {
    const { uid, store, getContext, now = Date.now } = dependencies;
    const authorize = async (context, actor, args) => {
        if (context.uid !== actor || !context.teams.get(args.teamId)?.roles?.has('parent')) throw new DomainError('permission_denied', 'Current linked-parent access is required.');
        assertLinks(await store.get(`users/${uid}`), args);
    };
    const assertOpen = ({ team, event }) => {
        const cutoff = rsvpCutoffAt(event.data.date, team.data.availabilityPreferences);
        if (cutoff !== null && now() >= cutoff) throw new DomainError('availability_locked', 'Availability is locked. No cutoff bypass is provided.');
    };
    const commands = createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ teamId, eventId, playerIds, response }) => {
            if (![teamId, eventId].every(safeId) || !Array.isArray(playerIds) || !playerIds.length || playerIds.length > 10
                || !playerIds.every(safeId) || new Set(playerIds).size !== playerIds.length || !responses.includes(response)) {
                throw new DomainError('invalid_argument', 'Select 1–10 unique exact linked player IDs on one exact event, and going/maybe/not_going.');
            }
            return { teamId, eventId, playerIds: [...playerIds].sort(), response };
        }, authorize,
        validateReceipt: (record) => [record.teamId, record.eventId].every(safeId) && Array.isArray(record.playerIds) && record.playerIds.length > 0 && record.playerIds.length <= 10 && record.playerIds.every(safeId) && new Set(record.playerIds).size === record.playerIds.length,
        result: ({ teamId, eventId, playerIds }) => ({ teamId, eventId, playerIds, summaryRefresh: 'not_performed',
            message: 'Outcome covers only the selected child-specific responses. Notes, base family responses, other responders, access and cached aggregate totals are unchanged. No messages are sent.' }),
        readTarget: async (reader, args) => {
            const profile = await reader.get(`users/${uid}`); assertLinks(profile, args);
            const team = await reader.get(`teams/${args.teamId}`); const event = await reader.get(basePath(args));
            if (!team.exists || !team.version || !event.exists || !event.version || !ordinaryScheduleEvent(event.data)) throw new DomainError('unsupported_event', 'Choose an ordinary scheduled event. Imported, recurring, cancelled and active events require app review.');
            const legacy = await reader.get(`${basePath(args)}/rsvps/${uid}`);
            if (legacy.exists) throw new DomainError('legacy_rsvp', 'This account has a base/family RSVP. Review reconciliation in the app; this tool does not change base responses or access.');
            const children = await Promise.all(args.playerIds.map(async (playerId) => {
                const player = await reader.get(`teams/${args.teamId}/players/${playerId}`);
                if (!player.exists || !player.version || player.data.active === false || !text(player.data.name, 120) || !player.data.name) throw new DomainError('unsupported_player', 'Every selected child must be an active supported roster player.');
                const response = await reader.get(childPath(args, uid, playerId)); assertCanonicalResponse(response, uid, playerId);
                return { playerId, player, response };
            }));
            const target = { profile, team, event, legacy, children }; assertOpen(target); return target;
        },
        revisions: ({ profile, team, event, legacy, children }) => ({ profile: profile.version, team: team.version, event: event.version, legacy: legacy.version,
            children: children.map(({ playerId, player, response }) => ({ playerId, player: player.version, response: response.version })) }),
        preview: ({ event, children }, args) => ({ action: 'Save selected linked children’s RSVPs', teamId: args.teamId, event: scheduleSummary(args.eventId, event.data), actorId: uid,
            children: children.map(({ playerId, player, response }) => ({ playerId, name: player.data.name, before: response.exists ? response.data.response : 'not_responded', after: args.response })),
            effect: 'Atomically saves these child-specific responses, visible to the team. Existing notes, base family RSVPs, other responders and access stay unchanged. No messages are sent. Cached totals are not refreshed.' }),
        beforeCommit: assertOpen, assertBeforeDispatch: assertOpen,
        apply: (tx, { children }, args) => {
            const patch = { response: args.response, respondedAt: new Date(now()) };
            for (const child of children) {
                if (child.response.exists) tx.patch(childPath(args, uid, child.playerId), patch);
                else tx.set(childPath(args, uid, child.playerId), { userId: uid, displayName: null, playerId: child.playerId, childId: child.playerId, playerIds: [child.playerId], ...patch });
            }
        }
    });
    return { ...commands, async discover({ teamId }) {
        if (!safeId(teamId)) throw new DomainError('invalid_argument', 'Use an exact team ID.');
        const profile = await store.get(`users/${uid}`);
        const keys = Array.isArray(profile.data?.parentPlayerKeys) ? profile.data.parentPlayerKeys : [];
        const playerIds = [...new Set(keys.filter((key) => typeof key === 'string' && key.startsWith(`${teamId}::`)).map((key) => key.slice(teamId.length + 2)))];
        if (!playerIds.length || playerIds.length > 20 || !playerIds.every(safeId)) throw new DomainError('unsupported_family', 'Choose a supported current linked family in the app.');
        const args = { teamId, playerIds }; await authorize(await getContext(), uid, args);
        const children = await Promise.all(playerIds.sort().map(async (playerId) => {
            const player = await store.get(`teams/${teamId}/players/${playerId}`);
            return { playerId, name: player.exists && text(player.data.name, 120) ? player.data.name : null, active: player.exists && player.data.active !== false };
        }));
        await authorize(await getContext(), uid, args);
        return { teamId, children, message: 'Explicitly select up to 10 linked children on the same event. Notes and base-family reconciliation require app review.' };
    } };
}
