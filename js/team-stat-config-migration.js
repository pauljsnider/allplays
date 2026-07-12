import { getDefaultStatConfigForSport } from './stat-config-presets.js?v=2';

function normalizeSportLabel(value) {
    return String(value || '').trim().toLowerCase();
}

function isHistoricalGame(game = {}) {
    const status = String(game?.status || '').trim().toLowerCase();
    const liveStatus = String(game?.liveStatus || '').trim().toLowerCase();
    return status === 'completed' || status === 'final' || status === 'cancelled' || liveStatus === 'completed';
}

export function buildTeamSportConfigMigrationPlan({ previousSport = '', nextSport = '', configs = [], games = [] } = {}) {
    const normalizedPreviousSport = normalizeSportLabel(previousSport);
    const normalizedNextSport = normalizeSportLabel(nextSport);
    const safeConfigs = Array.isArray(configs) ? configs : [];
    const safeGames = Array.isArray(games) ? games : [];

    if (!normalizedNextSport || normalizedPreviousSport === normalizedNextSport) {
        return {
            sportChanged: false,
            targetConfigId: null,
            targetConfigData: null,
            shouldCreateTargetConfig: false,
            gameIdsToUpdate: []
        };
    }

    const matchingConfig = safeConfigs.find((config) => (
        normalizeSportLabel(config?.baseType) === normalizedNextSport &&
        Array.isArray(config?.columns) &&
        config.columns.length > 0
    ));
    const targetConfigData = matchingConfig ? null : getDefaultStatConfigForSport(nextSport);

    const sourceConfigIds = safeConfigs
        .filter((config) => {
            const baseType = normalizeSportLabel(config?.baseType);
            return !!String(config?.id || '').trim() &&
                !!baseType &&
                baseType !== normalizedNextSport &&
                baseType === normalizedPreviousSport;
        })
        .map((config) => String(config.id).trim());

    const sourceConfigIdSet = new Set(sourceConfigIds);
    const gameIdsToUpdate = safeGames
        .filter((game) => !isHistoricalGame(game))
        .filter((game) => sourceConfigIdSet.has(String(game?.statTrackerConfigId || '').trim()))
        .map((game) => String(game.id || '').trim())
        .filter(Boolean);

    return {
        sportChanged: true,
        targetConfigId: matchingConfig ? String(matchingConfig.id || '').trim() || null : null,
        targetConfigData,
        shouldCreateTargetConfig: !matchingConfig && !!targetConfigData,
        gameIdsToUpdate
    };
}
