import { DomainError } from './core.js';
import { ID, fingerprint, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { createRosterDomainStore, safeFields, displayFields, normalizedName } from './directRoster.js';

const TOOL = 'mcp_direct_roster_batch';
const MAX_BATCH = 20;
export function createDirectRosterBatchStore(options) {
    return createRosterDomainStore(options, TOOL, ['teamId', 'playerIds', 'createdCount', 'updatedCount']);
}

// One approval covers the entire displayed batch. All rows and the receipt are
// committed together; there is no partial-success or retry-the-remaining flow.
export function createDirectRosterBatchCommands(dependencies) {
    const commands = createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ teamId, operations }) => {
            if (!ID.test(teamId || '') || !Array.isArray(operations) || !operations.length || operations.length > MAX_BATCH
                || operations.some((op) => !op || Object.keys(op).some((key) => !['mode', 'playerId', 'fields'].includes(key))
                    || !['create', 'update'].includes(op.mode) || !ID.test(op.playerId || '') || !safeFields(op.fields)
                    || (op.mode === 'create' && !op.fields.name))
                || new Set(operations.map((op) => op.playerId)).size !== operations.length) {
                throw new DomainError('invalid_argument', 'Provide 1–20 distinct player changes, using only name, number and position. Creates require names; updates require exact IDs.');
            }
            const createdCount = operations.filter((op) => op.mode === 'create').length;
            return { teamId, operations: operations.map((op) => ({ ...op, fields: { ...op.fields } })),
                playerIds: operations.map((op) => op.playerId), createdCount, updatedCount: operations.length - createdCount };
        },
        validateReceipt: (record) => ID.test(record.teamId || '') && Array.isArray(record.playerIds)
            && record.playerIds.length > 0 && record.playerIds.length <= MAX_BATCH
            && record.playerIds.every((id) => ID.test(id)) && new Set(record.playerIds).size === record.playerIds.length
            && Number.isInteger(record.createdCount) && record.createdCount >= 0 && Number.isInteger(record.updatedCount) && record.updatedCount >= 0
            && record.createdCount + record.updatedCount === record.playerIds.length,
        authorize: (context, uid, args) => validateManager(context, uid, args.teamId),
        result: ({ teamId, playerIds, createdCount, updatedCount }) => ({ teamId, playerIds, createdCount, updatedCount }),
        readTarget: async (reader, args) => {
            const team = await reader.get(`teams/${args.teamId}`);
            if (!team.exists || !team.version) throw new DomainError('not_found', 'The team is unavailable.');
            const roster = await reader.list(`teams/${args.teamId}/players`);
            if (roster.length + args.createdCount > 200) throw new DomainError('unsupported_roster', 'This bounded flow supports at most 200 players after the batch. Use app review for larger rosters.');
            const rows = new Map(roster.map((row) => [row.id, row]));
            const finalNames = new Map(roster.map((row) => [row.id, normalizedName(row.data.name)]));
            for (const op of args.operations) {
                if (op.mode === 'create' && rows.has(op.playerId)) throw new DomainError('conflict', 'A generated player ID exists. Check the same proposal outcome.');
                if (op.mode === 'update' && !rows.has(op.playerId)) throw new DomainError('not_found', 'An exact player ID is unavailable. No rows were changed.');
                if (op.fields.name) finalNames.set(op.playerId, normalizedName(op.fields.name));
            }
            for (const op of args.operations) {
                if (op.fields.name && [...finalNames].some(([id, name]) => id !== op.playerId && name === finalNames.get(op.playerId))) {
                    throw new DomainError('ambiguous_player', 'A proposed name matches another active or inactive player in the resulting roster. Review exact IDs in the app.');
                }
            }
            return { team, roster, rows };
        },
        revisions: ({ team, roster }) => ({ team: team.version, roster: fingerprint(roster.map((row) => [row.id, row.version])) }),
        preview: ({ team, rows }, args) => ({
            action: 'Apply one atomic roster batch', teamId: args.teamId, teamName: String(team.data.name || args.teamId),
            createdCount: args.createdCount, updatedCount: args.updatedCount,
            operations: args.operations.map((op) => {
                const row = rows.get(op.playerId);
                return { mode: op.mode, playerId: op.playerId, before: row ? displayFields(row.data) : null,
                    changes: op.fields, after: { ...(row ? displayFields(row.data) : { name: '', number: '', position: '' }), ...op.fields },
                    active: row ? row.data.active !== false : true };
            }),
            effect: 'Apply every displayed row together or none. No invitations or messages. Contacts, private fields and existing roster status are preserved.'
        }),
        apply: (transaction, target, args, { now }) => {
            const time = new Date(now());
            for (const op of args.operations) {
                const path = `teams/${args.teamId}/players/${op.playerId}`;
                if (op.mode === 'create') transaction.set(path, { ...op.fields, active: true, createdAt: time });
                else transaction.patch(path, { ...op.fields, updatedAt: time });
            }
        }
    });
    return { ...commands, prepare: ({ proposalId, teamId, operations }) => commands.prepare({ proposalId, teamId,
        operations: Array.isArray(operations) ? operations.map((op, index) => {
            if (op?.mode !== 'create') return op;
            if (op.playerId !== undefined) throw new DomainError('invalid_argument', 'New player IDs are generated from the proposal ID.');
            return { ...op, playerId: `mcp_${proposalId}_${index}` };
        }) : operations }) };
}
