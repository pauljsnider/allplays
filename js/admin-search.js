export const ADMIN_USER_SEARCH_MIN_LENGTH = 2;
export const ADMIN_USER_SEARCH_MAX_LENGTH = 100;
export const ADMIN_USER_SEARCH_DEBOUNCE_MS = 300;
export const ADMIN_USER_SEARCH_RESULT_LIMIT = 50;
export const ADMIN_USER_SEARCH_TEAM_LIMIT = 3;
export const ADMIN_USER_SEARCH_CONTACT_LIMIT = 20;
export const ADMIN_USER_SEARCH_CANDIDATE_QUERY_CEILING = 17;
export const ADMIN_OFFICIAL_ENRICHMENT_USER_LIMIT = ADMIN_USER_SEARCH_RESULT_LIMIT;
export const ADMIN_OFFICIAL_ENRICHMENT_QUERY_CEILING = 8;
export const ADMIN_USER_SEARCH_TOTAL_QUERY_CEILING =
    ADMIN_USER_SEARCH_CANDIDATE_QUERY_CEILING + ADMIN_OFFICIAL_ENRICHMENT_QUERY_CEILING;

export function normalizeAdminSearchTerm(value = '') {
    return String(value || '').trim().toLowerCase().slice(0, ADMIN_USER_SEARCH_MAX_LENGTH);
}

export function hasAdminGlobalSearchTerm(value = '') {
    return normalizeAdminSearchTerm(value).length > 0;
}

export function shouldRunRemoteAdminUserSearch(value = '') {
    return normalizeAdminSearchTerm(value).length >= ADMIN_USER_SEARCH_MIN_LENGTH;
}

export function toAdminSearchTitleCase(value = '') {
    return normalizeAdminSearchTerm(value).replace(/\b\w/g, (character) => character.toUpperCase());
}

export function normalizeAdminUserSearchIndexValue(value = '') {
    return normalizeAdminSearchTerm(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

export function buildAdminUserSearchHash(value = '') {
    const normalized = normalizeAdminUserSearchIndexValue(value);
    if (normalized.length < ADMIN_USER_SEARCH_MIN_LENGTH) return '';

    let hash = 2166136261;
    for (let index = 0; index < normalized.length; index += 1) {
        hash ^= normalized.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

export function buildAdminUserSearchStrategies(value = '') {
    const term = normalizeAdminSearchTerm(value);
    if (!shouldRunRemoteAdminUserSearch(term)) return [];

    const titleCaseTerm = toAdminSearchTitleCase(term);
    return {
        users: [
            { field: 'email', prefix: term },
            { field: 'fullName', prefix: titleCaseTerm },
            { field: 'phone', prefix: term }
        ],
        indexHash: buildAdminUserSearchHash(term),
        officials: term === 'official'
            ? [{ field: null, prefix: '' }]
            : [
                { field: 'email', prefix: term },
                { field: 'name', prefix: titleCaseTerm },
                { field: 'phone', prefix: term }
            ],
        teams: [{ field: 'name', prefix: titleCaseTerm }]
    };
}

export function mergeBoundedAdminUserCandidates(candidateGroups = [], resultLimit = ADMIN_USER_SEARCH_RESULT_LIMIT) {
    const usersById = new Map();
    candidateGroups.flat().forEach((user) => {
        const id = String(user?.id || '').trim();
        if (!id || usersById.has(id) || usersById.size >= resultLimit) return;
        usersById.set(id, user);
    });
    return Array.from(usersById.values());
}

export function mergeAdminUserSearchResults(pageUsers = [], remoteUsers = [], searchTerm = '') {
    const term = normalizeAdminSearchTerm(searchTerm);
    const pageMatches = pageUsers.filter((user) => [
        user?.email,
        user?.fullName,
        user?.phone
    ].some((value) => String(value || '').toLowerCase().includes(term)));
    return mergeBoundedAdminUserCandidates([pageMatches, remoteUsers]);
}

export function resolveAdminUserSearchResult(pageUsers = [], result = {}) {
    if (result.stale) return null;
    if (!result.remote) return pageUsers;
    return mergeAdminUserSearchResults(pageUsers, result.users, result.term);
}

export function createDebouncedAdminUserSearch({
    search,
    debounceMs = ADMIN_USER_SEARCH_DEBOUNCE_MS
} = {}) {
    if (typeof search !== 'function') {
        throw new TypeError('search must be a function');
    }

    let generation = 0;
    let pendingTimer = null;
    let settlePending = null;
    let pendingTerm = '';
    let retainedTerm = null;
    let retainedResult = null;
    let retainedPromise = null;

    function invalidate() {
        generation += 1;
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
            settlePending?.({ term: pendingTerm, users: [], stale: true, remote: false });
        }
        settlePending = null;
        pendingTerm = '';
        retainedTerm = null;
        retainedResult = null;
        retainedPromise = null;
    }

    function runAdminUserSearch(value = '') {
        const term = normalizeAdminSearchTerm(value);

        if (term === retainedTerm) {
            if (retainedPromise) return retainedPromise;
            if (retainedResult) return Promise.resolve(retainedResult);
        }

        const requestGeneration = ++generation;

        if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
            settlePending?.({ term: pendingTerm, users: [], stale: true, remote: false });
            settlePending = null;
            pendingTerm = '';
        }

        retainedTerm = term;
        retainedResult = null;
        retainedPromise = null;

        if (!shouldRunRemoteAdminUserSearch(term)) {
            retainedResult = { term, users: [], stale: false, remote: false };
            return Promise.resolve(retainedResult);
        }

        retainedPromise = new Promise((resolve, reject) => {
            settlePending = resolve;
            pendingTerm = term;
            pendingTimer = setTimeout(async () => {
                pendingTimer = null;
                settlePending = null;
                pendingTerm = '';
                try {
                    const users = await search(term);
                    const result = {
                        term,
                        users: Array.isArray(users) ? users.slice(0, ADMIN_USER_SEARCH_RESULT_LIMIT) : [],
                        stale: requestGeneration !== generation,
                        remote: true
                    };
                    if (!result.stale && retainedTerm === term) {
                        retainedResult = result;
                        retainedPromise = null;
                    }
                    resolve(result);
                } catch (error) {
                    if (requestGeneration !== generation) {
                        resolve({ term, users: [], stale: true, remote: true });
                        return;
                    }
                    if (retainedTerm === term) retainedPromise = null;
                    reject(error);
                }
            }, debounceMs);
        });

        return retainedPromise;
    }

    runAdminUserSearch.invalidate = invalidate;
    return runAdminUserSearch;
}

export async function loadCompleteAdminSearchCollection({ fetchPage, itemsKey, pageSize = 100 } = {}) {
    if (typeof fetchPage !== 'function') {
        throw new TypeError('fetchPage must be a function');
    }

    const items = [];
    let cursor = null;

    do {
        const page = await fetchPage({
            pageSize,
            ...(cursor ? { cursor } : {})
        });
        items.push(...(Array.isArray(page?.[itemsKey]) ? page[itemsKey] : []));
        cursor = page?.nextCursor || null;
    } while (cursor);

    return items;
}

export function selectAdminSearchCollection({ searchTerm = '', pageItems = [], globalItems = [] } = {}) {
    return hasAdminGlobalSearchTerm(searchTerm) ? globalItems : pageItems;
}

export function selectAdminItemById({ id = '', pageItems = [], globalItems = [], fallbackItems = [] } = {}) {
    const itemId = String(id || '');
    return [...pageItems, ...globalItems, ...fallbackItems].find((item) => String(item?.id || '') === itemId) || null;
}
