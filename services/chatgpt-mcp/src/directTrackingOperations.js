import { DomainError } from './core.js';
import { ID, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { createTeamProposalStore } from './directTeamProposalStore.js';
import { canonicalPrivateTrackingItem, editablePrivateTrackingItem } from './directTrackingItem.js';
import { canonicalStatus, createTrackingStatusDomainStore } from './directTrackingStatus.js';

const BATCH = 'mcp_direct_tracking_status_batch';
const LIFECYCLE = 'mcp_direct_tracking_lifecycle';
const safeId = (value) => typeof value === 'string' && ID.test(value);
const text = (value, max) => typeof value === 'string' && value === value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const itemPath = ({ teamId, itemId }) => `teams/${teamId}/trackingItems/${itemId}`;
const pathFor = (args, playerId) => `${itemPath(args)}/memberTracking/${playerId}`;
const authorize = (context, uid, args) => validateManager(context, uid, args.teamId);
const itemPattern = /^teams\/[A-Za-z0-9_-]{1,128}\/trackingItems\/[A-Za-z0-9_-]{1,128}$/;
async function readItem(reader, args, allowArchived = false) {
    const team = await reader.get(`teams/${args.teamId}`); const item = await reader.get(itemPath(args));
    if (!team.exists || !team.version || !item.exists || !item.version || !(allowArchived ? canonicalPrivateTrackingItem : editablePrivateTrackingItem)(item.data, args.teamId)) {
        throw new DomainError('unsupported_tracking_item', 'Select a supported private requirement. Public, extended or inconsistent items require app review; completion changes also require an active item.');
    }
    return { team, item };
}
export function createDirectTrackingBatchStore(options) {
    return createTrackingStatusDomainStore(options, BATCH, ['teamId', 'itemId', 'playerIds']);
}
export function createDirectTrackingBatchCommands(dependencies) {
    return createRevisionCommands(dependencies, {
        toolName: BATCH, authorize,
        args: ({ teamId, itemId, changes, playerIds }) => {
            if (![teamId, itemId].every(safeId) || !Array.isArray(changes) || !changes.length || changes.length > 20
                || changes.some((row) => !row || Object.getPrototypeOf(row) !== Object.prototype || Object.keys(row).sort().join(',') !== 'complete,playerId' || !safeId(row.playerId) || typeof row.complete !== 'boolean')
                || new Set(changes.map((row) => row.playerId)).size !== changes.length) throw new DomainError('invalid_argument', 'Select 1–20 distinct exact active player IDs with explicit complete booleans for one private item.');
            const rows = changes.map((row) => ({ ...row })).sort((a, b) => a.playerId.localeCompare(b.playerId));
            const ids = rows.map((row) => row.playerId);
            if (playerIds !== undefined && JSON.stringify(playerIds) !== JSON.stringify(ids)) throw new DomainError('invalid_argument', 'The receipt player IDs must match the exact selected rows.');
            return { teamId, itemId, changes: rows, playerIds: ids };
        },
        validateReceipt: (record) => [record.teamId, record.itemId].every(safeId) && Array.isArray(record.playerIds) && record.playerIds.length > 0 && record.playerIds.length <= 20 && record.playerIds.every(safeId) && new Set(record.playerIds).size === record.playerIds.length,
        result: ({ teamId, itemId, playerIds }) => ({ teamId, itemId, playerIds }),
        readTarget: async (reader, args) => {
            const shared = await readItem(reader, args);
            const rows = await Promise.all(args.changes.map(async ({ playerId, complete }) => {
                const player = await reader.get(`teams/${args.teamId}/players/${playerId}`);
                if (!player.exists || !player.version || player.data.active === false || !text(player.data.name, 120) || !player.data.name
                    || (player.data.number !== undefined && !text(player.data.number, 20))) throw new DomainError('unsupported_player', 'Every selected player must be active with supported name/number fields. No rows were changed.');
                const status = await reader.get(pathFor(args, playerId));
                if (status.exists && (!status.version || !canonicalStatus(status.data, { ...args, playerId }))) throw new DomainError('unsupported_tracking_status', 'A selected completion record is legacy or inconsistent. No row or note will be discarded.');
                return { playerId, complete, player, status };
            }));
            return { ...shared, rows };
        },
        revisions: ({ team, item, rows }) => ({ team: team.version, item: item.version, rows: rows.map(({ playerId, player, status }) => ({ playerId, player: player.version, status: status.version })) }),
        preview: ({ item, rows }, args) => ({ action: 'Save one atomic private tracking batch', teamId: args.teamId, itemId: args.itemId, itemName: item.data.name,
            changes: rows.map(({ playerId, complete, player, status }) => ({ playerId, playerName: player.data.name, playerNumber: player.data.number || '', before: status.exists ? status.data.complete : null, complete })),
            effect: 'All selected completions change together or none. Unselected players, the private item, roster and access are preserved. No messages, invitations or payments occur; no email audit is stored.' }),
        apply: (tx, { rows }, args, { uid, now }) => {
            const updatedAt = new Date(now());
            for (const { playerId, complete, player, status } of rows) {
                const data = { teamId: args.teamId, trackingItemId: args.itemId, playerId, playerName: player.data.name, playerNumber: player.data.number || '', memberType: 'player',
                    status: complete ? 'complete' : 'incomplete', complete, updatedBy: uid, updatedByEmail: null, updatedAt };
                if (status.exists) tx.patch(pathFor(args, playerId), data); else tx.set(pathFor(args, playerId), data);
            }
        }
    });
}
export function createDirectTrackingLifecycleStore(options) {
    const base = createTeamProposalStore(options, { toolName: LIFECYCLE, receiptFields: ['teamId', 'itemId', 'active'], policy: {
        read: (path) => itemPattern.test(path) || /^teams\/[A-Za-z0-9_-]{1,128}$/.test(path), write: (path) => itemPattern.test(path),
        patch: (path, data) => itemPattern.test(path) && Object.keys(data).sort().join(',') === 'active,archived,status,updatedAt,updatedBy'
            && typeof data.active === 'boolean' && data.archived === !data.active && data.status === (data.active ? 'active' : 'archived')
            && data.updatedBy === options.uid && data.updatedAt instanceof Date && Number.isFinite(data.updatedAt.getTime())
    } });
    // Lifecycle tools can only patch existing items, never replace/create them.
    return { ...base, transaction: (callback, settings) => base.transaction((tx) => callback({ ...tx, set: (path, data) => {
        if (itemPattern.test(path)) throw new DomainError('permission_denied', 'Lifecycle changes require an exact patch of an existing item.');
        return tx.set(path, data);
    } }), settings) };
}
export function createDirectTrackingLifecycleCommands(dependencies) {
    return createRevisionCommands(dependencies, {
        toolName: LIFECYCLE, authorize,
        args: ({ teamId, itemId, active }) => {
            if (![teamId, itemId].every(safeId) || typeof active !== 'boolean') throw new DomainError('invalid_argument', 'Select an exact private item and explicit active boolean.');
            return { teamId, itemId, active };
        },
        validateReceipt: (record) => [record.teamId, record.itemId].every(safeId) && typeof record.active === 'boolean',
        result: ({ teamId, itemId, active }) => ({ teamId, itemId, active }),
        readTarget: (reader, args) => readItem(reader, args, true),
        revisions: ({ team, item }) => ({ team: team.version, item: item.version }),
        preview: ({ item }, args) => ({ action: args.active ? 'Activate one private tracking requirement' : 'Archive one private tracking requirement', teamId: args.teamId, itemId: args.itemId, itemName: item.data.name,
            before: item.data.status, after: args.active ? 'active' : 'archived', requiredAcknowledgements: ['trackingLifecycle'],
            effect: 'Archiving hides this requirement from active lists without deleting completion records. Reactivation restores the requirement with its existing completion records, including later authorized edits. This is not a reset or completion snapshot. Visibility, text, creation audit and access stay unchanged. No messages are sent.' }),
        apply: (tx, target, args, { uid, now }) => tx.patch(itemPath(args), { active: args.active, archived: !args.active, status: args.active ? 'active' : 'archived', updatedAt: new Date(now()), updatedBy: uid })
    });
}
