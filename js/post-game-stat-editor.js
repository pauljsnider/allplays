import { buildConfiguredStatFields } from './game-report-stats.js?v=1';

function normalizeStatKey(key) {
    return String(key || '').trim().toLowerCase();
}

export function resolvePostGameStatFields({ resolvedConfig = null, statsMap = {} } = {}) {
    const statsObjects = Object.values(statsMap || {});
    let fields = [];

    if (Array.isArray(resolvedConfig?.columns) && resolvedConfig.columns.length > 0) {
        fields = buildConfiguredStatFields(resolvedConfig.columns, statsObjects);
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
    }

    if (!fields.some((field) => field.fieldName === 'fouls')) {
        fields.push({ fieldName: 'fouls', label: 'FOULS' });
    }

    return fields;
}

function normalizeNumericInput(value) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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

    return {
        playerName: player.name || '',
        playerNumber: player.number || player.num || '',
        stats,
        didNotPlay: !!didNotPlay,
        timeMs: didNotPlay ? 0 : (Number.isFinite(Number(existingTimeMs)) ? Number(existingTimeMs) : 0)
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
