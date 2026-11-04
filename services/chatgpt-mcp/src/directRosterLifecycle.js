import { DomainError } from './core.js';
import { ID, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { createTeamProposalStore } from './directTeamProposalStore.js';

const TOOL = 'mcp_direct_roster_lifecycle';
const playerPattern = /^teams\/[A-Za-z0-9_-]{1,128}\/players\/[A-Za-z0-9_-]{1,128}$/;
const pathFor = (teamId, playerId) => `teams/${teamId}/players/${playerId}`;
const safeId = (value) => typeof value === 'string' && ID.test(value);
const date = (value) => value instanceof Date && Number.isFinite(value.getTime());
const mask = ['active', 'deactivatedAt', 'updatedAt'];
export function createDirectRosterLifecycleStore(options) {
    const base = createTeamProposalStore(options, { toolName: TOOL, receiptFields: ['teamId', 'playerIds'], policy: {
        read: (path) => playerPattern.test(path) || /^teams\/[A-Za-z0-9_-]{1,128}$/.test(path), write: (path) => playerPattern.test(path),
        patchFields: (path, data, fieldPaths) => playerPattern.test(path) && typeof data.active === 'boolean' && date(data.updatedAt)
            && Object.keys(data).sort().join(',') === (data.active ? 'active,updatedAt' : 'active,deactivatedAt,updatedAt')
            && (data.active || date(data.deactivatedAt) && data.deactivatedAt.getTime() === data.updatedAt.getTime())
            && Array.isArray(fieldPaths) && JSON.stringify([...fieldPaths].sort()) === JSON.stringify(mask)
    } });
    return { ...base, transaction: (callback, settings) => base.transaction((tx) => callback({ ...tx, set: (path, data) => {
        if (playerPattern.test(path)) throw new DomainError('permission_denied', 'Roster lifecycle changes only patch existing player status fields.');
        return tx.set(path, data);
    } }), settings) };
}
export function createDirectRosterLifecycleCommands(dependencies) {
    return createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ teamId, changes, playerIds }) => {
            if (!safeId(teamId) || !Array.isArray(changes) || !changes.length || changes.length > 20
                || changes.some((row) => !row || Object.getPrototypeOf(row) !== Object.prototype || Object.keys(row).sort().join(',') !== 'active,playerId'
                    || !safeId(row.playerId) || typeof row.active !== 'boolean') || new Set(changes.map((row) => row.playerId)).size !== changes.length) {
                throw new DomainError('invalid_argument', 'Select 1–20 distinct exact player IDs with explicit active booleans. No other roster fields or access changes may be combined.');
            }
            const rows = changes.map((row) => ({ ...row })).sort((a, b) => a.playerId.localeCompare(b.playerId)); const ids = rows.map((row) => row.playerId);
            if (playerIds !== undefined && JSON.stringify(ids) !== JSON.stringify(playerIds)) throw new DomainError('invalid_argument', 'The receipt IDs must match every selected player.');
            return { teamId, changes: rows, playerIds: ids };
        },
        authorize: (context, uid, args) => validateManager(context, uid, args.teamId),
        validateReceipt: (record) => safeId(record.teamId) && Array.isArray(record.playerIds) && record.playerIds.length > 0 && record.playerIds.length <= 20
            && record.playerIds.every(safeId) && new Set(record.playerIds).size === record.playerIds.length,
        result: ({ teamId, playerIds }) => ({ teamId, playerIds }),
        readTarget: async (reader, args) => {
            const team = await reader.get(`teams/${args.teamId}`);
            if (!team.exists || !team.version || team.data.active === false || team.data.archived === true) throw new DomainError('unsupported_team', 'Choose an available managed team.');
            const players = await Promise.all(args.changes.map(async ({ playerId, active }) => {
                const player = await reader.get(pathFor(args.teamId, playerId)); const data = player.data;
                if (!player.exists || !player.version || !data || typeof data.name !== 'string' || !data.name || data.name !== data.name.trim() || data.name.length > 120 || /[\u0000-\u001f\u007f]/.test(data.name)
                    || (data.active !== undefined && typeof data.active !== 'boolean') || data.deleted === true
                    || (data.deactivatedAt != null && (!date(data.deactivatedAt) || data.active !== false))) throw new DomainError('unsupported_player', 'A selected player has unsupported or inconsistent lifecycle state. Use app review; no records were changed.');
                if ((data.active !== false) === active) throw new DomainError('conflict', 'A selected player already has the requested status. Prepare only the changes still needed; no deactivation timestamp was reset.');
                return { playerId, active, player };
            }));
            return { team, players };
        },
        revisions: ({ team, players }) => ({ team: team.version, players: players.map(({ playerId, player }) => ({ playerId, version: player.version })) }),
        preview: ({ players }, args) => ({ action: 'Apply one atomic roster lifecycle batch', teamId: args.teamId,
            changes: players.map(({ playerId, active, player }) => ({ playerId, name: player.data.name, before: player.data.active !== false, active })),
            requiredAcknowledgements: ['rosterLifecycle'],
            effect: 'Deactivation removes players from active-roster views and can hide them from active-player selectors and family schedules. History and stored family links/document permissions remain; deactivation is not access revocation. Existing public RSVP links and active-player communication eligibility may stop or resume under current app checks. Reactivation restores active-roster participation and clears the deactivation marker. Existing games, RSVPs, assignments, completion records, private profiles, photos and family links are not rewritten. Every selected change applies together or none; no invitations or messages are sent.' }),
        apply: (tx, target, args, { now }) => {
            const time = new Date(now());
            for (const { playerId, active } of args.changes) {
                // An omitted field inside the exact REST update mask deletes
                // only deactivatedAt on reactivation, matching deleteField().
                tx.patchFields(pathFor(args.teamId, playerId), { active, ...(active ? {} : { deactivatedAt: time }), updatedAt: time }, mask);
            }
        }
    });
}
