import presets from './teamSetupPresets.json' with { type: 'json' };
import { DomainError } from './core.js';
import { ID, fingerprint, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { createTeamProposalStore } from './directTeamProposalStore.js';

const TOOL = 'mcp_direct_team_setup';
const teamPath = /^teams\/[A-Za-z0-9_-]{1,128}$/;
const configPath = /^teams\/[A-Za-z0-9_-]{1,128}\/statTrackerConfigs\/[A-Za-z0-9_-]{1,128}$/;
const safeId = (value) => typeof value === 'string' && ID.test(value);
const name = (value) => typeof value === 'string' && value.length > 0 && value.length <= 120 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const zip = (value) => typeof value === 'string' && /^(?:[0-9]{5}|[0-9]{9})?$/.test(value);
const label = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
export const TEAM_SETUP_PRESET_IDS = Object.freeze(Object.keys(presets));
export const teamSetupPreset = (id) => Object.hasOwn(presets, id) ? structuredClone(presets[id]) : null;
function assertTeam(team) {
    if (!team.exists || !team.version || !name(team.data.name) || team.data.active === false || team.data.archived === true
        || (team.data.active !== undefined && typeof team.data.active !== 'boolean') || (team.data.archived !== undefined && typeof team.data.archived !== 'boolean')
        || (team.data.isPublic !== undefined && typeof team.data.isPublic !== 'boolean')
        || (team.data.zip !== undefined && team.data.zip !== null && !zip(team.data.zip))) {
        throw new DomainError('unsupported_team', 'Use app review for inactive, archived or legacy team details.');
    }
}
export function createDirectTeamSetupStore(options) {
    const base = createTeamProposalStore(options, { toolName: TOOL, receiptFields: ['teamId', 'mode', 'configId'], policy: {
        read: (path) => teamPath.test(path) || configPath.test(path),
        write: (path) => teamPath.test(path) || configPath.test(path),
        patch: (path, data) => teamPath.test(path) && data.updatedAt instanceof Date
            && Object.keys(data).every((key) => ['name', 'zip', 'updatedAt'].includes(key))
            && (data.name === undefined || name(data.name)) && (data.zip === undefined || zip(data.zip)),
        query: (path) => /^teams\/[A-Za-z0-9_-]{1,128}\/statTrackerConfigs$/.test(path) ? { fields: ['name', 'baseType'], limit: 101 } : null
    } });
    return { ...base, transaction: (callback, settings) => base.transaction((tx) => callback({ ...tx, set: (path, data) => {
        if (teamPath.test(path)) throw new DomainError('permission_denied', 'Team details may only use the bounded field patch.');
        return tx.set(path, data);
    } }), settings) };
}
export function createDirectTeamSetupCommands(dependencies) {
    const { uid, store, getContext } = dependencies;
    const authorize = (context, actor, args) => validateManager(context, actor, args.teamId);
    const load = async (reader, args) => {
        const team = await reader.get(`teams/${args.teamId}`); assertTeam(team);
        const configs = args.mode === 'details' ? [] : await reader.list(`teams/${args.teamId}/statTrackerConfigs`);
        if (configs.length > 100) throw new DomainError('unsupported_configuration', 'Use app review for more than 100 configurations; no partial duplicate check was used.');
        return { team, configs };
    };
    const commands = createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ mode, teamId, configId = null, presetId, name: configName, changes }) => {
            if (!safeId(teamId) || !['details', 'preset'].includes(mode)) throw new DomainError('invalid_argument', 'Use an exact team ID and supported setup action.');
            if (mode === 'details') {
                if (configId !== null || !changes || Object.getPrototypeOf(changes) !== Object.prototype || !Object.keys(changes).length
                    || Object.keys(changes).some((key) => !['name', 'zip'].includes(key))
                    || (Object.hasOwn(changes, 'name') && !name(changes.name)) || (Object.hasOwn(changes, 'zip') && !zip(changes.zip))) {
                    throw new DomainError('invalid_argument', 'Specify only a trimmed name (1–120 characters) and/or ZIP (five or nine digits, or empty to clear).');
                }
                return { mode, teamId, configId: null, changes: { ...changes } };
            }
            if (!safeId(configId) || !TEAM_SETUP_PRESET_IDS.includes(presetId) || !name(configName)) throw new DomainError('invalid_argument', 'Choose a reviewed preset, exact new configuration ID and trimmed name.');
            return { mode, teamId, configId, presetId, name: configName };
        }, authorize,
        validateReceipt: (record) => safeId(record.teamId) && (record.mode === 'details' ? record.configId === null : record.mode === 'preset' && safeId(record.configId)),
        result: ({ teamId, mode, configId }) => ({ teamId, mode, configId }),
        readTarget: async (reader, args) => {
            const state = await load(reader, args);
            if (args.mode === 'details') {
                const before = { name: state.team.data.name, zip: state.team.data.zip ?? '' }; const after = { ...before, ...args.changes };
                if (Object.keys(args.changes).every((key) => before[key] === after[key])) throw new DomainError('conflict', 'The team details already match.');
                return { ...state, before, after, target: null };
            }
            const target = await reader.get(`teams/${args.teamId}/statTrackerConfigs/${args.configId}`);
            if (target.exists) throw new DomainError('conflict', 'The new configuration ID already exists. Check the original proposal outcome.');
            if (state.configs.some((row) => label(row.data.name) === label(args.name))) throw new DomainError('conflict', 'A configuration with this name already exists. Use its exact ID or choose another name.');
            return { ...state, target, before: null, after: { ...teamSetupPreset(args.presetId), name: args.name } };
        },
        revisions: ({ team, configs, target }) => ({ team: team.version, target: target?.version || null, configs: fingerprint(configs.map((row) => [row.id, row.version])) }),
        preview: ({ team, before, after }, args) => ({ action: args.mode === 'details' ? 'Update team name or ZIP' : 'Create a stat configuration from an app preset',
            teamId: args.teamId, teamName: team.data.name, configId: args.configId, before, after,
            ...(args.mode === 'preset' ? { presetId: args.presetId, requiredAcknowledgements: ['publicConfiguration'] } : {}),
            effect: args.mode === 'details'
                ? `Updates only the selected name/ZIP fields. Details may appear wherever this team or its shared games are shown. Current team visibility is ${team.data.isPublic === true ? 'public' : 'private'}. Visibility, sport, access, media and links remain unchanged. Existing backend membership caches may refresh; no notification send is requested.`
                : 'Creates publicly readable configuration metadata, including its name and complete preset definitions, even for a private team. The app may automatically select this preset for analytics and change displayed metrics. Does not attach it to games, change recorded stats, enable Diamond, change team sport or send messages.' }),
        apply: (tx, { after }, args, { now }) => {
            if (args.mode === 'details') tx.patch(`teams/${args.teamId}`, { ...args.changes, updatedAt: new Date(now()) });
            else tx.set(`teams/${args.teamId}/statTrackerConfigs/${args.configId}`, { ...after, createdAt: new Date(now()) });
        }
    });
    return { ...commands, async discover({ teamId }) {
        if (!safeId(teamId)) throw new DomainError('invalid_argument', 'Use an exact team ID.');
        await authorize(await getContext(), uid, { teamId }); const { team, configs } = await load(store, { teamId }); await authorize(await getContext(), uid, { teamId });
        return { teamId, details: { name: team.data.name, zip: team.data.zip ?? '', isPublic: team.data.isPublic === true },
            presets: TEAM_SETUP_PRESET_IDS.map((id) => ({ id, name: presets[id].name, baseType: presets[id].baseType })),
            configurations: configs.map((row) => ({ id: row.id, name: typeof row.data.name === 'string' ? row.data.name : null })),
            message: 'Only name/ZIP changes and new preset configurations are supported here. Configuration metadata is publicly readable; every create requires a distinct acknowledgement.' };
    } };
}
