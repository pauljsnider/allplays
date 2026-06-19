export const DEFAULT_ADMIN_PAGE_SIZE = 25;

export function normalizeAdminPageSize(rawPageSize) {
    const pageSize = Number(rawPageSize);
    if (!Number.isFinite(pageSize)) return DEFAULT_ADMIN_PAGE_SIZE;
    return Math.min(Math.max(Math.floor(pageSize), 1), 100);
}

export async function loadAdminCollectionPage({ fetchPage, cursor = null, pageSize = DEFAULT_ADMIN_PAGE_SIZE }) {
    if (typeof fetchPage !== 'function') {
        throw new Error('fetchPage is required');
    }

    return fetchPage({
        cursor,
        pageSize: normalizeAdminPageSize(pageSize)
    });
}

export async function loadInitialAdminBootstrap({
    getTeamsPage,
    getUsersPage,
    loadTelemetryData,
    pageSize = DEFAULT_ADMIN_PAGE_SIZE
} = {}) {
    const normalizedPageSize = normalizeAdminPageSize(pageSize);
    const [teamsPage, usersPage] = await Promise.all([
        loadAdminCollectionPage({ fetchPage: getTeamsPage, pageSize: normalizedPageSize }),
        loadAdminCollectionPage({ fetchPage: getUsersPage, pageSize: normalizedPageSize })
    ]);

    return {
        teamsPage,
        usersPage,
        telemetryPromise: typeof loadTelemetryData === 'function'
            ? Promise.resolve(loadTelemetryData({ silent: true }))
            : Promise.resolve()
    };
}
