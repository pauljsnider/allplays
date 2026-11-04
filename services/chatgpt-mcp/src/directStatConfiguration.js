import { DomainError } from './core.js';
import { ID, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { createDirectCommandStore } from './directCommandStore.js';

const configurationPath = (teamId, configId) => `teams/${teamId}/statTrackerConfigs/${configId}`;
const configuration = /^teams\/[A-Za-z0-9_-]{1,128}\/statTrackerConfigs\/[A-Za-z0-9_-]{1,128}$/;
const fields = ['name', 'baseType', 'columns', 'statDefinitions', 'scoringColumn', 'diamondPublicTeamStatIds'];
const metadata = ['id', 'createdAt', 'updatedAt'];
const definitionFields = ['id', 'label', 'acronym', 'type', 'formula', 'group', 'scope', 'visibility', 'format', 'precision', 'rankingOrder', 'topStat'];
const text = (value, max = 120) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

// Clone the stored schema exactly; do not re-normalize it or change visibility,
// scoring, formulas or game references. Unknown extensions require app review.
export function cloneableConfiguration(data) {
    if (!data || Object.keys(data).some((key) => !fields.includes(key) && !metadata.includes(key))
        || !text(data.name) || !text(data.baseType) || !Array.isArray(data.columns) || data.columns.length > 100
        || data.columns.some((column) => !text(column)) || !Array.isArray(data.statDefinitions) || data.statDefinitions.length > 200
        || data.statDefinitions.some((definition) => !definition || typeof definition !== 'object' || Array.isArray(definition)
            || Object.entries(definition).some(([key, value]) => !definitionFields.includes(key)
                || !(value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || text(value, 1000))))
        || (data.scoringColumn !== undefined && !text(data.scoringColumn))
        || (data.diamondPublicTeamStatIds !== undefined && (!Array.isArray(data.diamondPublicTeamStatIds)
            || data.diamondPublicTeamStatIds.length > 200 || data.diamondPublicTeamStatIds.some((id) => !text(id))))) {
        throw new DomainError('unsupported_configuration', 'This configuration requires the app editor before it can be cloned. No fields were silently discarded.');
    }
    const result = Object.fromEntries(fields.filter((key) => data[key] !== undefined).map((key) => [key, structuredClone(data[key])]));
    if (JSON.stringify(result).length > 32000) throw new DomainError('unsupported_configuration', 'This configuration is too large for the bounded preview. Use the app.');
    return result;
}

export function createDirectStatConfigurationStore(options) {
    return createDirectCommandStore(options, {
        read: (path) => configuration.test(path) || /^teams\/[A-Za-z0-9_-]{1,128}$/.test(path),
        write: (path) => configuration.test(path),
        patch: (path, data) => configuration.test(path) && Object.keys(data).length === 2
            && typeof data.name === 'string' && data.updatedAt instanceof Date
    });
}

export function createDirectStatConfigurationCommands(dependencies) {
    return createRevisionCommands(dependencies, {
        toolName: 'mcp_direct_stat_configuration',
        args: ({ mode, teamId, configId, sourceConfigId = null, name }) => {
            if (!['clone', 'rename'].includes(mode) || !ID.test(teamId || '') || !ID.test(configId || '')
                || !text(name) || !name.trim() || name !== name.trim()
                || (mode === 'clone' ? !ID.test(sourceConfigId || '') || sourceConfigId === configId : sourceConfigId !== null)) {
                throw new DomainError('invalid_argument', 'Provide exact IDs, clone or rename, and a trimmed name of 1–120 characters.');
            }
            return { mode, teamId, configId, sourceConfigId, name };
        },
        authorize: (context, uid, args) => validateManager(context, uid, args.teamId),
        result: ({ mode, teamId, configId, name }) => ({ mode, teamId, configId, name }),
        readTarget: async (reader, args) => {
            const team = await reader.get(`teams/${args.teamId}`);
            const target = await reader.get(configurationPath(args.teamId, args.configId));
            const source = args.mode === 'clone' ? await reader.get(configurationPath(args.teamId, args.sourceConfigId)) : target;
            if (!team.exists || !source.exists) throw new DomainError('not_found', 'The team or source configuration is unavailable.');
            if (args.mode === 'clone' && target.exists) throw new DomainError('conflict', 'The new configuration ID already exists. Check the existing proposal outcome.');
            if (!team.version || !source.version || (target.exists && !target.version)) throw new DomainError('unavailable', 'Target revisions could not be verified.');
            return { team, source, target };
        },
        revisions: ({ team, source, target }) => ({ team: team.version, source: source.version, target: target.version || null }),
        preview: ({ team, source }, args) => ({
            action: args.mode === 'clone' ? 'Create a stat configuration by cloning' : 'Rename a stat configuration',
            teamId: args.teamId, teamName: String(team.data.name || args.teamId), configId: args.configId,
            sourceConfigId: args.sourceConfigId, previousName: String(source.data.name || ''), name: args.name,
            ...(args.mode === 'clone' ? { configuration: { ...cloneableConfiguration(source.data), name: args.name } } : {}),
            effect: args.mode === 'clone' ? 'Creates one new configuration. No game is assigned to it.' : 'Changes only the name and updated timestamp. Existing scoring, visibility, formulas and game references remain unchanged.'
        }),
        apply: (transaction, { source }, args, { now }) => {
            const path = configurationPath(args.teamId, args.configId);
            if (args.mode === 'clone') transaction.set(path, { ...cloneableConfiguration(source.data), name: args.name, createdAt: new Date(now()) });
            else transaction.patch(path, { name: args.name, updatedAt: new Date(now()) });
        }
    });
}
