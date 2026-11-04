import { DomainError } from './core.js';
import { ID, fingerprint, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { createTeamProposalStore } from './directTeamProposalStore.js';

const TOOL = 'mcp_direct_tracking_item';
const pathFor = ({ teamId, itemId }) => `teams/${teamId}/trackingItems/${itemId}`;
const itemPath = /^teams\/[A-Za-z0-9_-]{1,128}\/trackingItems\/[A-Za-z0-9_-]{1,128}$/;
const itemFields = ['teamId', 'name', 'description', 'visibility', 'status', 'active', 'archived', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'];
const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && value === value.trim()
    && (!required || value.length > 0) && !/[\u0000-\u001f\u007f]/.test(value);
const label = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
export function canonicalPrivateTrackingItem(data, teamId) {
    return Boolean(data && !Array.isArray(data) && Object.keys(data).every((key) => itemFields.includes(key))
        && data.teamId === teamId && text(data.name, 120, true) && (data.description === undefined || text(data.description, 2000))
        && data.visibility === 'private' && ['active', 'archived'].includes(data.status)
        && data.active === (data.status === 'active') && data.archived === (data.status === 'archived')
        && typeof data.createdBy === 'string' && ID.test(data.createdBy) && data.createdAt instanceof Date && Number.isFinite(data.createdAt.getTime()));
}
export function editablePrivateTrackingItem(data, teamId) {
    return canonicalPrivateTrackingItem(data, teamId) && data.status === 'active';
}
export function createDirectTrackingItemStore(options) {
    return createTeamProposalStore(options, { toolName: TOOL, receiptFields: ['teamId', 'itemId', 'mode'], policy: {
        read: (path) => itemPath.test(path) || /^teams\/[A-Za-z0-9_-]{1,128}$/.test(path),
        write: (path) => itemPath.test(path),
        patch: (path, data) => itemPath.test(path) && data.updatedAt instanceof Date && data.updatedBy === options.uid
            && Object.keys(data).every((key) => ['name', 'description', 'updatedAt', 'updatedBy'].includes(key))
            && (data.name === undefined || text(data.name, 120, true)) && (data.description === undefined || text(data.description, 2000)),
        query: (path) => /^teams\/[A-Za-z0-9_-]{1,128}\/trackingItems$/.test(path) ? { fields: ['name', 'title', 'label'], limit: 201 } : null
    } });
}
export function createDirectTrackingItemCommands(dependencies) {
    return createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ mode, teamId, itemId, changes }) => {
            if (!['create', 'update'].includes(mode) || ![teamId, itemId].every((value) => typeof value === 'string' && ID.test(value))
                || !changes || Object.getPrototypeOf(changes) !== Object.prototype || !Object.keys(changes).length
                || Object.keys(changes).some((key) => !['name', 'description'].includes(key))
                || (mode === 'create' && !Object.hasOwn(changes, 'name'))
                || (Object.hasOwn(changes, 'name') && !text(changes.name, 120, true))
                || (Object.hasOwn(changes, 'description') && !text(changes.description, 2000))) {
                throw new DomainError('invalid_argument', 'Use exact IDs and a trimmed name (1–120 characters) or description (0–2000). Only private active tracking-item text is supported.');
            }
            return { mode, teamId, itemId, changes: structuredClone(changes) };
        },
        validateReceipt: (record) => [record.teamId, record.itemId].every((value) => typeof value === 'string' && ID.test(value)) && ['create', 'update'].includes(record.mode),
        authorize: (context, uid, args) => validateManager(context, uid, args.teamId),
        result: ({ teamId, itemId, mode }) => ({ teamId, itemId, mode }),
        readTarget: async (reader, args) => {
            const team = await reader.get(`teams/${args.teamId}`); const item = await reader.get(pathFor(args));
            if (!team.exists || !team.version) throw new DomainError('not_found', 'The managed team is unavailable.');
            if (args.mode === 'create' && item.exists) throw new DomainError('conflict', 'This item ID already exists. Check the original proposal result.');
            if (args.mode === 'update' && (!item.exists || !item.version || !editablePrivateTrackingItem(item.data, args.teamId))) {
                throw new DomainError('unsupported_tracking_item', 'Only current private, active tracking items with the supported schema can be edited here. Use app review for public, archived or legacy items.');
            }
            const before = item.exists ? { name: item.data.name, description: item.data.description ?? '' } : null;
            const after = { ...(before || { description: '' }), ...args.changes };
            const items = args.mode === 'create' || Object.hasOwn(args.changes, 'name') ? await reader.list(`teams/${args.teamId}/trackingItems`) : [];
            if (items.length > 200) throw new DomainError('unsupported_tracking_list', 'Use app review for teams with more than 200 tracking items; no partial duplicate check was used.');
            if (items.some((row) => row.id !== args.itemId && [row.data.name, row.data.title, row.data.label].some((name) => label(name) === label(after.name)))) {
                throw new DomainError('ambiguous_tracking_item', 'A matching tracking item already exists. Choose its exact ID or review in the app.');
            }
            return { team, item, items, before, after };
        },
        revisions: ({ team, item, items }) => ({ team: team.version, item: item.version, items: fingerprint(items.map((row) => [row.id, row.version])) }),
        preview: ({ team, before, after }, args) => ({ action: `${args.mode === 'create' ? 'Create' : 'Update'} one private tracking item`, teamId: args.teamId,
            teamName: String(team.data.name || args.teamId), itemId: args.itemId, before, changes: args.changes, after,
            visibility: 'private', status: 'active', effect: 'Staff-only item text. No publication, player completion changes, messages, invitations, payments or deletion.' }),
        apply: (tx, { after }, args, { uid, now }) => {
            if (args.mode === 'create') tx.set(pathFor(args), { teamId: args.teamId, ...after, visibility: 'private', status: 'active', active: true, archived: false,
                createdAt: new Date(now()), createdBy: uid, updatedAt: new Date(now()), updatedBy: uid });
            else tx.patch(pathFor(args), { ...args.changes, updatedAt: new Date(now()), updatedBy: uid });
        }
    });
}
