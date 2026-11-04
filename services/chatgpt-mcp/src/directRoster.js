import { DomainError } from './core.js';
import { ID, fingerprint, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { createDirectCommandStore } from './directCommandStore.js';

const TOOL = 'mcp_direct_roster_player';
const playerPath = (teamId, playerId) => `teams/${teamId}/players/${playerId}`;
const fieldNames = ['name', 'number', 'position'];
const normalizedName = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const safeText = (value, max) => typeof value === 'string' && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const safeFields = (fields) => fields && typeof fields === 'object' && !Array.isArray(fields)
    && Object.keys(fields).length > 0 && Object.entries(fields).every(([key, value]) => fieldNames.includes(key)
        && safeText(value, key === 'name' ? 120 : key === 'number' ? 20 : 60) && (key !== 'name' || value.length > 0));
const displayFields = (data) => Object.fromEntries(fieldNames.map((key) => [key,
    typeof data?.[key] === 'string' || (key === 'number' && typeof data?.[key] === 'number') ? data[key] : '']));

// Virtual proposals are split: opaque user metadata/receipts and expiring
// team-authorized content. No player names or field values enter user history.
export function createDirectRosterStore(options) {
    const { uid } = options;
    if (!ID.test(uid)) throw new Error('A verified actor is required.');
    const userProposal = new RegExp(`^users/${uid}/privateAiPendingActions/direct_([a-f0-9-]{36})$`);
    const teamProposal = new RegExp(`^teams/[A-Za-z0-9_-]{1,128}/privateAiPendingActions/direct_${uid}_[a-f0-9-]{36}$`);
    const player = /^teams\/[A-Za-z0-9_-]{1,128}\/players\/[A-Za-z0-9_-]{1,128}$/;
    const base = createDirectCommandStore(options, {
        read: (path) => player.test(path) || teamProposal.test(path) || /^teams\/[A-Za-z0-9_-]{1,128}$/.test(path),
        write: (path) => player.test(path) || teamProposal.test(path),
        prepare: (path) => teamProposal.test(path),
        delete: (path) => teamProposal.test(path),
        patch: (path, data) => player.test(path) && data.updatedAt instanceof Date
            && safeFields(Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'updatedAt'))),
        query: (path) => /^teams\/[A-Za-z0-9_-]{1,128}\/players$/.test(path)
            ? { fields: ['name', 'number', 'position', 'active'], limit: 201 } : null
    });
    const companionPath = (path, record) => {
        const match = userProposal.exec(path);
        if (!match || !ID.test(record?.teamId || '')) throw new DomainError('invalid_argument', 'Invalid team proposal.');
        return `teams/${record.teamId}/privateAiPendingActions/direct_${uid}_${match[1]}`;
    };
    const metadata = (record, completed = false) => ({
        userId: uid, toolName: TOOL, teamId: record.teamId, playerId: record.playerId, mode: record.mode,
        digest: record.digest, expiresAt: record.expiresAt, status: completed ? 'completed' : 'prepared',
        ...(completed ? { receiptOnly: true, completedAt: record.completedAt } : {})
    });
    const read = async (reader, path) => {
        const header = await reader.get(path);
        if (!userProposal.test(path) || !header.exists || header.data.receiptOnly === true) return header;
        const content = await reader.get(companionPath(path, header.data));
        if (!content.exists || content.data.userId !== uid || content.data.toolName !== TOOL
            || content.data.status !== 'pending' || content.data.digest !== header.data.digest
            || header.data.teamId !== content.data.teamId || header.data.playerId !== content.data.playerId
            || header.data.mode !== content.data.mode || header.data.expiresAt !== content.data.expiresAt) {
            throw new DomainError('conflict', 'The team proposal is unavailable or changed.');
        }
        return { exists: true, version: `${header.version}:${content.version}`, data: { ...content.data, status: 'prepared' } };
    };
    return {
        get: (path) => read(base, path),
        list: base.list,
        create: (path, record) => base.create(path, metadata(record), [{
            path: companionPath(path, record),
            data: { ...record, status: 'pending', expiresAtAt: new Date(record.expiresAt) }
        }]),
        transaction: (callback, settings) => base.transaction((tx) => callback({
            get: (path) => read(tx, path), list: tx.list, patch: tx.patch,
            set: (path, record) => {
                if (!userProposal.test(path)) return tx.set(path, record);
                if (record.status !== 'completed' || record.toolName !== TOOL || record.userId !== uid) throw new DomainError('invalid_argument', 'Only a completed roster receipt may be saved.');
                tx.set(path, metadata(record, true));
                tx.delete(companionPath(path, record));
            }
        }), settings)
    };
}

export function createDirectRosterCommands(dependencies) {
    return createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ mode, teamId, playerId, fields }) => {
            if (!['create', 'update'].includes(mode) || !ID.test(teamId || '') || !ID.test(playerId || '')
                || !safeFields(fields) || (mode === 'create' && !fields.name)) {
                throw new DomainError('invalid_argument', 'Use exact team/player IDs and only name, number or position. Creating requires a name. Contact, access and custom fields require app review.');
            }
            return { mode, teamId, playerId, fields: { ...fields } };
        },
        validateReceipt: (record) => ID.test(record.teamId || '') && ID.test(record.playerId || '') && ['create', 'update'].includes(record.mode),
        authorize: (context, uid, args) => validateManager(context, uid, args.teamId),
        result: ({ mode, teamId, playerId }) => ({ mode, teamId, playerId }),
        readTarget: async (reader, args) => {
            const team = await reader.get(`teams/${args.teamId}`);
            if (!team.exists || !team.version) throw new DomainError('not_found', 'The team is unavailable.');
            const roster = await reader.list(`teams/${args.teamId}/players`);
            if (roster.length > 200) throw new DomainError('unsupported_roster', 'Use the app for rosters larger than 200 players. No partial duplicate check was used.');
            const target = roster.find((row) => row.id === args.playerId) || { exists: false, version: null, data: null };
            if (args.mode === 'create' && target.exists) throw new DomainError('conflict', 'The player ID already exists. Check the same proposal outcome.');
            if (args.mode === 'update' && !target.exists) throw new DomainError('not_found', 'Select an existing exact player ID.');
            // Creation and renaming must never guess whether a matching active
            // or inactive name means the same child. Other edits use exact IDs.
            if (args.fields.name && roster.some((row) => row.id !== args.playerId && normalizedName(row.data.name) === normalizedName(args.fields.name))) {
                throw new DomainError('ambiguous_player', 'That name already exists on the active or inactive roster. Review the matching IDs in the app before adding or renaming.');
            }
            return { team, target, roster };
        },
        revisions: ({ team, roster }) => ({ team: team.version, roster: fingerprint(roster.map((row) => [row.id, row.version])) }),
        preview: ({ team, target }, args) => ({
            action: args.mode === 'create' ? 'Create one roster player' : 'Update one roster player',
            teamId: args.teamId, teamName: String(team.data.name || args.teamId), playerId: args.playerId,
            before: target.exists ? displayFields(target.data) : null, changes: args.fields,
            after: { ...(target.exists ? displayFields(target.data) : { name: '', number: '', position: '' }), ...args.fields },
            active: args.mode === 'create' ? true : target.data.active !== false,
            effect: 'No invitations or messages. Only these displayed public roster fields change; contacts, private profiles and access remain unchanged.'
        }),
        apply: (transaction, target, args, { now }) => {
            if (args.mode === 'create') transaction.set(playerPath(args.teamId, args.playerId), { ...args.fields, active: true, createdAt: new Date(now()) });
            else transaction.patch(playerPath(args.teamId, args.playerId), { ...args.fields, updatedAt: new Date(now()) });
        }
    });
}
