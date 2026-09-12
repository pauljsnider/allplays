const DIAMOND_SCOREBOOK_UI_FEATURE = 'diamondScorebookUiEnabled';
const DIAMOND_SCOREBOOK_UI_META = 'allplays-diamond-scorebook-ui-enabled';

function readRuntimeConfig() {
    try {
        const runtimeConfig = globalThis.window?.__ALLPLAYS_CONFIG__;
        return runtimeConfig && typeof runtimeConfig === 'object'
            ? runtimeConfig
            : undefined;
    } catch (_error) {
        return undefined;
    }
}

export function readStagedLaunchFeatureConfig(documentRef = globalThis.document) {
    try {
        const value = documentRef
            ?.querySelector(`meta[name="${DIAMOND_SCOREBOOK_UI_META}"]`)
            ?.getAttribute('content');
        if (value !== 'true' && value !== 'false') return undefined;
        return { [DIAMOND_SCOREBOOK_UI_FEATURE]: value === 'true' };
    } catch (_error) {
        return undefined;
    }
}

export function resolveLaunchFeatureFlag(feature, runtimeConfig, stagedConfig) {
    if (
        runtimeConfig
        && typeof runtimeConfig === 'object'
        && Object.prototype.hasOwnProperty.call(runtimeConfig, feature)
    ) {
        return runtimeConfig[feature] === true;
    }
    return stagedConfig?.[feature] === true;
}

function isLaunchFeatureEnabled(feature) {
    try {
        return resolveLaunchFeatureFlag(
            feature,
            readRuntimeConfig(),
            readStagedLaunchFeatureConfig()
        );
    } catch (_error) {
        return false;
    }
}

export function isDiamondScorebookUiEnabled() {
    return isLaunchFeatureEnabled(DIAMOND_SCOREBOOK_UI_FEATURE);
}
