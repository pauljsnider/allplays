import { buildConfiguredStatFields } from './game-report-stats.js?v=1';
import { normalizeStatTrackerConfig } from './stat-leaderboards.js?v=2';

const DEFAULT_POST_GAME_STAT_FIELDS = [
    { fieldName: 'pts', label: 'PTS' },
    { fieldName: 'rebs', label: 'REBS' },
    { fieldName: 'ast', label: 'AST' },
    { fieldName: 'fouls', label: 'FOULS' }
];

export function normalizeStatKey(key) {
    return String(key || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function resolvePostGameStatFields({ resolvedConfig = null, statsMap = {} } = {}) {
    const statsObjects = Object.values(statsMap || {});
    let fields = [];

    if (Array.isArray(resolvedConfig?.columns) && resolvedConfig.columns.length > 0) {
        fields = buildConfiguredStatFields(resolvedConfig.columns, statsObjects)
            .map((field) => ({
                ...field,
                fieldName: normalizeStatKey(field?.fieldName)
            }))
            .filter((field) => field.fieldName);
    }

    if (fields.length === 0) {
        const discoveredKeys = new Set();
        statsObjects.forEach((stats) => {
            Object.keys(stats || {}).forEach((key) => discoveredKeys.add(normalizeStatKey(key)));
        });
        fields = Array.from(discoveredKeys)
            .filter(Boolean)
            .sort()
            .map((key) => ({ fieldName: key, label: key.toUpperCase() }));

        if (fields.length === 0) {
            fields = DEFAULT_POST_GAME_STAT_FIELDS.map((field) => ({ ...field }));
        }
    }

    const existingFieldNames = new Set(fields.map((field) => normalizeStatKey(field?.fieldName)).filter(Boolean));
    const privatePlayerFields = normalizeStatTrackerConfig(resolvedConfig || {}).statDefinitions
        .filter((definition) => definition.scope === 'player' && definition.visibility === 'private' && definition.type === 'base')
        .map((definition) => ({
            fieldName: normalizeStatKey(definition.id),
            label: definition.label || definition.acronym || definition.id.toUpperCase()
        }))
        .filter((field) => field.fieldName && !existingFieldNames.has(field.fieldName));

    privatePlayerFields.forEach((field) => {
        fields.push(field);
        existingFieldNames.add(field.fieldName);
    });

    if (!existingFieldNames.has('fouls')) {
        fields.push({ fieldName: 'fouls', label: 'FOULS' });
    }

    return fields;
}

function normalizeNumericInput(value) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}


export function resolvePostGameTeamStatFields({ resolvedConfig = null, teamStats = {} } = {}) {
    const definitions = Array.isArray(resolvedConfig?.statDefinitions) ? resolvedConfig.statDefinitions : [];
    const configuredFields = definitions
        .filter((definition) => definition?.scope === 'team' && definition?.type !== 'derived')
        .map((definition) => ({
            fieldName: normalizeStatKey(definition.id || definition.acronym || definition.label),
            label: definition.label || definition.acronym || definition.id || 'Team stat'
        }))
        .filter((field) => field.fieldName);

    const byKey = new Map();
    configuredFields.forEach((field) => byKey.set(field.fieldName, field));

    Object.keys(teamStats || {}).forEach((key) => {
        const fieldName = normalizeStatKey(key);
        if (fieldName && !byKey.has(fieldName)) {
            byKey.set(fieldName, { fieldName, label: fieldName.toUpperCase() });
        }
    });

    return Array.from(byKey.values());
}

export function buildCompletedGameTeamStatsPayload({
    statFields = [],
    values = {}
} = {}) {
    const stats = {};
    statFields.forEach((field) => {
        const key = normalizeStatKey(field?.fieldName);
        if (!key) return;
        stats[key] = normalizeNumericInput(values[key]);
    });

    return { stats };
}

export function resolvePostGameEditorDidNotPlay({
    playerId = '',
    didNotPlayMap = {},
    pendingDidNotPlayMap = {}
} = {}) {
    if (Object.prototype.hasOwnProperty.call(pendingDidNotPlayMap || {}, playerId)) {
        return pendingDidNotPlayMap[playerId] === true;
    }
    return didNotPlayMap?.[playerId] === true;
}

export function buildCompletedGamePlayerStatsPayload({
    player = {},
    statFields = [],
    values = {},
    didNotPlay = false,
    existingTimeMs = 0
} = {}) {
    const stats = {};
    statFields.forEach((field) => {
        const key = normalizeStatKey(field?.fieldName);
        if (!key) return;
        stats[key] = didNotPlay ? 0 : normalizeNumericInput(values[key]);
    });

    const appeared = didNotPlay !== true;

    return {
        playerName: player.name || '',
        playerNumber: player.number || player.num || '',
        stats,
        didNotPlay: !appeared,
        timeMs: appeared ? (Number.isFinite(Number(existingTimeMs)) ? Number(existingTimeMs) : 0) : 0,
        participated: appeared,
        participationStatus: appeared ? 'appeared' : 'did-not-appear',
        participationSource: appeared ? 'post-game-stat-editor' : ''
    };
}

export function getPostGameEditorNextIndex(currentIndex, direction, totalPlayers) {
    const total = Number.parseInt(totalPlayers, 10);
    if (!Number.isFinite(total) || total <= 0) return -1;

    const start = Math.min(Math.max(Number.parseInt(currentIndex, 10) || 0, 0), total - 1);
    if (direction === 'previous') {
        return start > 0 ? start - 1 : 0;
    }
    if (direction === 'next') {
        return start < total - 1 ? start + 1 : total - 1;
    }
    return start;
}
