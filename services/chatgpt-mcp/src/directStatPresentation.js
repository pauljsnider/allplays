import { DomainError } from './core.js';
import { ID, fingerprint, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { createTeamProposalStore } from './directTeamProposalStore.js';
import { TEAM_SETUP_PRESET_IDS, teamSetupPreset } from './directTeamSetup.js';

const TOOL = 'mcp_direct_stat_presentation';
const configPattern = /^teams\/[A-Za-z0-9_-]{1,128}\/statTrackerConfigs\/[A-Za-z0-9_-]{1,128}$/;
const pathFor = ({ teamId, configId }) => `teams/${teamId}/statTrackerConfigs/${configId}`;
const safeId = (value) => typeof value === 'string' && ID.test(value);
const name = (value) => typeof value === 'string' && value.length > 0 && value.length <= 120 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const normalizedName = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
const presentationKeys = ['format', 'precision', 'rankingOrder'];
const projection = (definition) => Object.fromEntries(['id', 'label', ...presentationKeys].map((key) => [key, definition[key]]));
const presentation = (data) => ['number', 'percentage'].includes(data?.format) && Number.isInteger(data.precision) && data.precision >= 0 && data.precision <= 6 && ['asc', 'desc'].includes(data.rankingOrder);
const structure = (definitions) => definitions.map((definition) => Object.fromEntries(Object.entries(definition).filter(([key]) => !presentationKeys.includes(key))));
function presetFor(data) {
    if (!data || Object.getPrototypeOf(data) !== Object.prototype || !name(data.name) || Object.keys(data).some((key) => !['name', 'baseType', 'columns', 'statDefinitions', 'id', 'createdAt', 'updatedAt'].includes(key))
        || !Array.isArray(data.columns) || !Array.isArray(data.statDefinitions) || !data.statDefinitions.length || data.statDefinitions.length > 100 || data.statDefinitions.some((definition) => !definition || Object.getPrototypeOf(definition) !== Object.prototype || !presentation(definition))) return null;
    return TEAM_SETUP_PRESET_IDS.find((id) => {
        const preset = teamSetupPreset(id);
        return data.baseType === preset.baseType && fingerprint(data.columns) === fingerprint(preset.columns) && fingerprint(structure(data.statDefinitions)) === fingerprint(structure(preset.statDefinitions));
    }) || null;
}
function assertConfig(data) {
    if (!presetFor(data)) throw new DomainError('unsupported_configuration', 'Only the four reviewed preset schemas, with presentation-only customizations, are supported. Custom formulas, identities, visibility, Diamond and extended records require app review.');
    return data;
}
function validDefinitionPatch(data) {
    return data.updatedAt instanceof Date && Number.isFinite(data.updatedAt.getTime()) && Object.keys(data).sort().join(',') === 'statDefinitions,updatedAt'
        && TEAM_SETUP_PRESET_IDS.some((id) => presetFor({ ...teamSetupPreset(id), statDefinitions: data.statDefinitions }) === id);
}
export function createDirectStatPresentationStore(options) {
    const base = createTeamProposalStore(options, { toolName: TOOL, receiptFields: ['teamId', 'configId', 'mode'], policy: {
        read: (path) => configPattern.test(path) || /^teams\/[A-Za-z0-9_-]{1,128}$/.test(path), write: (path) => configPattern.test(path),
        patch: (path, data) => configPattern.test(path) && validDefinitionPatch(data),
        query: (path) => /^teams\/[A-Za-z0-9_-]{1,128}\/statTrackerConfigs$/.test(path) ? { fields: ['name'], limit: 101 } : null
    } });
    return { ...base, transaction: (callback, settings) => base.transaction((tx) => {
        const missing = new Set();
        return callback({ ...tx, get: async (path) => { const row = await tx.get(path); if (configPattern.test(path) && !row.exists) missing.add(path); return row; }, set: (path, data) => {
            if (configPattern.test(path) && (!missing.delete(path) || !presetFor(data) || !(data.createdAt instanceof Date) || Object.keys(data).some((key) => ['id', 'updatedAt'].includes(key)))) throw new DomainError('permission_denied', 'Only a verified missing configuration may be created from a reviewed schema.');
            return tx.set(path, data);
        } });
    }, settings) };
}
export function createDirectStatPresentationCommands(dependencies) {
    const { uid, store, getContext } = dependencies;
    const authorize = (context, actor, args) => validateManager(context, actor, args.teamId);
    const loadTeam = async (reader, teamId) => {
        const team = await reader.get(`teams/${teamId}`);
        if (!team.exists || !team.version || team.data.active === false || team.data.archived === true) throw new DomainError('unsupported_team', 'Choose an available managed team.');
        return team;
    };
    const commands = createRevisionCommands(dependencies, {
        toolName: TOOL, authorize,
        args: ({ mode, teamId, configId, presetId, name: configName, changes }) => {
            if (!['create', 'update'].includes(mode) || ![teamId, configId].every(safeId)
                || (mode === 'create' ? !TEAM_SETUP_PRESET_IDS.includes(presetId) || !name(configName) : presetId !== undefined || configName !== undefined)
                || !Array.isArray(changes) || !changes.length || changes.length > 20 || changes.some((row) => !row || Object.getPrototypeOf(row) !== Object.prototype || !safeId(row.statId)
                    || Object.keys(row).some((key) => !['statId', ...presentationKeys].includes(key)) || Object.keys(row).length < 2
                    || (Object.hasOwn(row, 'format') && !['number', 'percentage'].includes(row.format))
                    || (Object.hasOwn(row, 'precision') && (!Number.isInteger(row.precision) || row.precision < 0 || row.precision > 6))
                    || (Object.hasOwn(row, 'rankingOrder') && !['asc', 'desc'].includes(row.rankingOrder)))
                || new Set(changes.map((row) => row.statId)).size !== changes.length) throw new DomainError('invalid_argument', 'Select 1–20 unique exact stat IDs and only format, precision (0–6) or rankingOrder. New configs require a reviewed preset and name.');
            return { mode, teamId, configId, ...(mode === 'create' ? { presetId, name: configName } : {}), changes: changes.map((row) => ({ ...row })).sort((a, b) => a.statId.localeCompare(b.statId)) };
        },
        validateReceipt: (record) => [record.teamId, record.configId].every(safeId) && ['create', 'update'].includes(record.mode),
        result: ({ teamId, configId, mode }) => ({ teamId, configId, mode }),
        readTarget: async (reader, args) => {
            const team = await loadTeam(reader, args.teamId); const target = await reader.get(pathFor(args));
            if (args.mode === 'create' && target.exists) throw new DomainError('conflict', 'That new configuration ID already exists. Check the original proposal.');
            if (args.mode === 'update' && (!target.exists || !target.version)) throw new DomainError('not_found', 'Choose an existing exact configuration ID.');
            const source = args.mode === 'create' ? { ...teamSetupPreset(args.presetId), name: args.name } : assertConfig(target.data);
            const configs = args.mode === 'create' ? await reader.list(`teams/${args.teamId}/statTrackerConfigs`) : [];
            if (configs.length > 100) throw new DomainError('unsupported_configuration', 'Use app review for more than 100 configurations.');
            if (configs.some((row) => normalizedName(row.data.name) === normalizedName(args.name))) throw new DomainError('conflict', 'A configuration with this name already exists.');
            if (args.changes.some((row) => !source.statDefinitions.some((definition) => definition.id === row.statId))) throw new DomainError('invalid_argument', 'A selected stat ID is not in this reviewed schema.');
            const changes = new Map(args.changes.map(({ statId, ...values }) => [statId, values]));
            const definitions = source.statDefinitions.map((definition) => ({ ...definition, ...(changes.get(definition.id) || {}) }));
            if (args.mode === 'update' && fingerprint(definitions) === fingerprint(source.statDefinitions)) throw new DomainError('conflict', 'Those presentation settings already match.');
            return { team, target, source, definitions, configs };
        },
        revisions: ({ team, target, configs }) => ({ team: team.version, target: target.version, configs: fingerprint(configs.map((row) => [row.id, row.version])) }),
        preview: ({ source, definitions }, args) => ({ action: args.mode === 'create' ? 'Create a customized stat preset' : 'Update stat display and ranking settings', teamId: args.teamId, configId: args.configId, name: source.name, baseType: source.baseType,
            changes: args.changes.map(({ statId }) => ({ statId, before: projection(source.statDefinitions.find((row) => row.id === statId)), after: projection(definitions.find((row) => row.id === statId)) })),
            ...(args.mode === 'create' ? { configuration: { ...source, statDefinitions: definitions } } : {}), requiredAcknowledgements: ['publicConfiguration', 'statPresentation'],
            effect: 'Configuration metadata is publicly readable, even on a private team. These changes alter displayed rounding, percentage suffixes and/or leaderboard order, including historical displays; percentage format adds a suffix and does not multiply the value. New configurations may be automatically selected for analytics. Stat IDs, labels, columns, formulas, scoring, visibility, Top Stat selections, game references and recorded values remain fixed. No messages are sent.' }),
        apply: (tx, { source, definitions }, args, { now }) => {
            if (args.mode === 'create') tx.set(pathFor(args), { ...source, statDefinitions: definitions, createdAt: new Date(now()) });
            else tx.patch(pathFor(args), { statDefinitions: definitions, updatedAt: new Date(now()) });
        }
    });
    return { ...commands, async discover({ teamId, configId, presetId }) {
        if (!safeId(teamId) || (configId !== undefined) === (presetId !== undefined) || (configId !== undefined && !safeId(configId)) || (presetId !== undefined && !TEAM_SETUP_PRESET_IDS.includes(presetId))) throw new DomainError('invalid_argument', 'Choose one exact existing config or reviewed preset on a managed team.');
        await authorize(await getContext(), uid, { teamId }); await loadTeam(store, teamId);
        const row = configId !== undefined ? await store.get(pathFor({ teamId, configId })) : null;
        if (row && (!row.exists || !row.version)) throw new DomainError('not_found', 'The selected configuration is unavailable.');
        const source = assertConfig(row ? row.data : teamSetupPreset(presetId)); await authorize(await getContext(), uid, { teamId });
        return { teamId, ...(configId ? { configId } : { presetId }), name: source.name, stats: source.statDefinitions.map(projection), message: 'Only display format, precision and ranking direction may change. Metadata is public; every create or update requires distinct confirmations.' };
    } };
}
