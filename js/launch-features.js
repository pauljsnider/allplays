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

export function isDiamondScorebookUiEnabled() {
    try {
        return readRuntimeConfig()?.diamondScorebookUiEnabled === true;
    } catch (_error) {
        return false;
    }
}
