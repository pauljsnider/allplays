import path from 'node:path';

const VERSIONED_MODULE_PATTERN = /(['"])((?:\.\.\/|\.\/)+[^'"?]+\.js)\?v=(\d+)\1/g;

export function resolveVersionedModulePath(consumerPath, specifier) {
    if (!String(specifier || '').startsWith('.')) return null;
    const resolved = path.posix.normalize(path.posix.join(
        path.posix.dirname(String(consumerPath || '')),
        specifier
    ));
    return resolved.startsWith('js/') && !resolved.startsWith('../') ? resolved : null;
}

export function collectVersionedModuleImports(sources = []) {
    const importsByModule = new Map();
    for (const sourceEntry of sources) {
        const consumer = String(sourceEntry?.path || '').trim();
        const source = String(sourceEntry?.source || '');
        if (!consumer || !source) continue;
        for (const match of source.matchAll(VERSIONED_MODULE_PATTERN)) {
            const modulePath = resolveVersionedModulePath(consumer, match[2]);
            if (!modulePath) continue;
            const entries = importsByModule.get(modulePath) || [];
            entries.push({ consumer, version: Number(match[3]) });
            importsByModule.set(modulePath, entries);
        }
    }
    return importsByModule;
}

export function findStaleVersionedModuleImports({
    changedFiles = new Set(),
    previousImports = new Map(),
    currentImports = new Map()
} = {}) {
    const failures = [];
    for (const modulePath of changedFiles) {
        const previousEntries = previousImports.get(modulePath) || [];
        const currentEntries = currentImports.get(modulePath) || [];
        if (!previousEntries.length || !currentEntries.length) continue;

        const previousMax = Math.max(...previousEntries.map((entry) => entry.version));
        const currentVersions = [...new Set(currentEntries.map((entry) => entry.version))];
        if (currentVersions.length !== 1) {
            failures.push({
                modulePath,
                reason: 'mixed-current-versions',
                previousMax,
                currentVersions,
                consumers: currentEntries.map((entry) => entry.consumer)
            });
            continue;
        }
        if (currentVersions[0] <= previousMax) {
            failures.push({
                modulePath,
                reason: 'version-not-increased',
                previousMax,
                currentVersions,
                consumers: currentEntries.map((entry) => entry.consumer)
            });
        }
    }
    return failures;
}
