import { DomainError } from './core.js';
import { ID, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { createTeamProposalStore } from './directTeamProposalStore.js';
import { editablePrivateTrackingItem } from './directTrackingItem.js';

const TOOL = 'mcp_direct_tracking_status';
const statusPath = (args) => `teams/${args.teamId}/trackingItems/${args.itemId}/memberTracking/${args.playerId}`;
const statusPattern = /^teams\/[A-Za-z0-9_-]{1,128}\/trackingItems\/[A-Za-z0-9_-]{1,128}\/memberTracking\/[A-Za-z0-9_-]{1,128}$/;
const fields = ['teamId', 'trackingItemId', 'playerId', 'playerName', 'playerNumber', 'memberType', 'status', 'complete', 'updatedBy', 'updatedByEmail', 'updatedAt'];
const text = (value, max) => typeof value === 'string' && value === value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
export const canonicalStatus = (data, args) => data && !Array.isArray(data) && Object.keys(data).every((key) => fields.includes(key))
    && data.teamId === args.teamId && data.trackingItemId === args.itemId && data.playerId === args.playerId && data.memberType === 'player'
    && typeof data.complete === 'boolean' && data.status === (data.complete ? 'complete' : 'incomplete')
    && text(data.playerName, 120) && text(data.playerNumber, 20)
    && (data.updatedBy === null || typeof data.updatedBy === 'string' && ID.test(data.updatedBy))
    && (data.updatedByEmail === null || text(data.updatedByEmail, 320))
    && data.updatedAt instanceof Date && Number.isFinite(data.updatedAt.getTime());

export function createTrackingStatusDomainStore(options, toolName, receiptFields) {
    return createTeamProposalStore(options, { toolName, receiptFields, policy: {
        read: (path) => statusPattern.test(path) || /^teams\/[A-Za-z0-9_-]{1,128}(\/(trackingItems|players)\/[A-Za-z0-9_-]{1,128})?$/.test(path),
        write: (path) => statusPattern.test(path),
        patch: (path, data) => statusPattern.test(path) && data.updatedBy === options.uid && data.updatedByEmail === null
            && data.updatedAt instanceof Date && typeof data.complete === 'boolean' && data.status === (data.complete ? 'complete' : 'incomplete')
            && Object.keys(data).every((key) => fields.includes(key))
    } });
}
export function createDirectTrackingStatusStore(options) {
    return createTrackingStatusDomainStore(options, TOOL, ['teamId', 'itemId', 'playerId']);
}
export function createDirectTrackingStatusCommands(dependencies) {
    return createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ teamId, itemId, playerId, complete }) => {
            if (![teamId, itemId, playerId].every((value) => typeof value === 'string' && ID.test(value)) || typeof complete !== 'boolean') {
                throw new DomainError('invalid_argument', 'Use exact team, tracking-item and player IDs plus an explicit complete boolean.');
            }
            return { teamId, itemId, playerId, complete };
        },
        validateReceipt: (record) => [record.teamId, record.itemId, record.playerId].every((value) => typeof value === 'string' && ID.test(value)),
        authorize: (context, uid, args) => validateManager(context, uid, args.teamId),
        result: ({ teamId, itemId, playerId }) => ({ teamId, itemId, playerId }),
        readTarget: async (reader, args) => {
            const team = await reader.get(`teams/${args.teamId}`);
            const item = await reader.get(`teams/${args.teamId}/trackingItems/${args.itemId}`);
            const player = await reader.get(`teams/${args.teamId}/players/${args.playerId}`);
            if (!team.exists || !team.version || !item.exists || !item.version || !editablePrivateTrackingItem(item.data, args.teamId)) {
                throw new DomainError('unsupported_tracking_item', 'Choose a supported private active tracking item. Public, archived or legacy items require app review.');
            }
            if (!player.exists || !player.version || player.data.active === false || !text(player.data.name, 120) || !player.data.name
                || (player.data.number !== undefined && !text(player.data.number, 20))) throw new DomainError('unsupported_player', 'Choose an exact active roster player with a supported name and number.');
            const target = await reader.get(statusPath(args));
            if (target.exists && (!target.version || !canonicalStatus(target.data, args))) {
                throw new DomainError('unsupported_tracking_status', 'The existing completion record has a legacy or inconsistent shape. Review it in the app; no fields were discarded.');
            }
            return { team, item, player, target };
        },
        revisions: ({ team, item, player, target }) => ({ team: team.version, item: item.version, player: player.version, status: target.version }),
        preview: ({ team, item, player, target }, args) => ({ action: 'Save one private player tracking status', teamId: args.teamId,
            teamName: String(team.data.name || args.teamId), itemId: args.itemId, itemName: item.data.name, playerId: args.playerId,
            playerName: player.data.name, playerNumber: player.data.number || '', previousComplete: target.exists ? target.data.complete : null, complete: args.complete,
            effect: 'Records this one private requirement as complete or incomplete for this player. Does not change the item, roster, access, other players or send messages. No email address is stored in the audit.' }),
        apply: (tx, { player, target }, args, { uid, now }) => {
            // Matches buildTrackingStatusPayload in js/tracking-status-admin.js
            // (covered by parity regression), with nullable email audit and the
            // updated timestamp normally added by setTeamTrackingStatus.
            const data = { teamId: args.teamId, trackingItemId: args.itemId, playerId: args.playerId,
                playerName: player.data.name, playerNumber: player.data.number || '', memberType: 'player',
                status: args.complete ? 'complete' : 'incomplete', complete: args.complete,
                updatedBy: uid, updatedByEmail: null, updatedAt: new Date(now()) };
            if (target.exists) tx.patch(statusPath(args), data); else tx.set(statusPath(args), data);
        }
    });
}
