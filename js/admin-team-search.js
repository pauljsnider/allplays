import {
    db,
    collection,
    getDocs,
    limit,
    orderBy,
    query,
    where
} from './firebase.js?v=26';

export const ADMIN_TEAM_SEARCH_MIN_LENGTH = 2;
export const ADMIN_TEAM_SEARCH_MAX_LENGTH = 100;
export const ADMIN_TEAM_SEARCH_DEBOUNCE_MS = 300;
export const ADMIN_TEAM_SEARCH_RESULT_LIMIT = 50;
export const ADMIN_TEAM_SEARCH_QUERY_CEILING = 5;

export function normalizeAdminTeamSearchTerm(value = '') {
    return String(value || '').trim().toLowerCase().slice(0, ADMIN_TEAM_SEARCH_MAX_LENGTH);
}

function toAdminTeamSearchTitleCase(value = '') {
    return normalizeAdminTeamSearchTerm(value).replace(/\b\w/g, (character) => character.toUpperCase());
}

export function shouldRunRemoteAdminTeamSearch(value = '') {
    return normalizeAdminTeamSearchTerm(value).length >= ADMIN_TEAM_SEARCH_MIN_LENGTH;
}

export function buildAdminTeamSearchStrategies(value = '') {
    const term = normalizeAdminTeamSearchTerm(value);
    if (!shouldRunRemoteAdminTeamSearch(term)) return [];

    const titleCaseTerm = toAdminTeamSearchTitleCase(term);
    return [
        { field: 'publicSearchName', prefix: term },
        { field: 'name', prefix: titleCaseTerm },
        { field: 'name', prefix: term },
        { field: 'sport', prefix: titleCaseTerm },
        { field: 'sport', prefix: term }
    ];
}

function matchesAdminTeamSearch(team, term) {
    return [team?.name, team?.sport]
        .some((value) => String(value || '').toLowerCase().includes(term));
}

export function mergeAdminTeamSearchResults(
    pageTeams = [],
    remoteTeams = [],
    searchTerm = '',
    resultLimit = ADMIN_TEAM_SEARCH_RESULT_LIMIT
) {
    const term = normalizeAdminTeamSearchTerm(searchTerm);
    const teamsById = new Map();
    [...pageTeams, ...remoteTeams].forEach((team) => {
        const id = String(team?.id || '').trim();
        if (
            !id
            || teamsById.has(id)
            || teamsById.size >= resultLimit
            || !matchesAdminTeamSearch(team, term)
        ) return;
        teamsById.set(id, team);
    });
    return Array.from(teamsById.values());
}

function buildAdminTeamPrefixQuery(reference, strategy) {
    return query(
        reference,
        where(strategy.field, '>=', strategy.prefix),
        where(strategy.field, '<=', `${strategy.prefix}\uf8ff`),
        orderBy(strategy.field),
        limit(ADMIN_TEAM_SEARCH_RESULT_LIMIT)
    );
}

/** Runs exactly five limited Firestore candidate queries, independent of team count. */
export async function searchAdminTeams(searchTerm = '') {
    const strategies = buildAdminTeamSearchStrategies(searchTerm);
    if (!strategies.length) return [];

    const teamsRef = collection(db, 'teams');
    const snapshots = await Promise.all(strategies.map((strategy) =>
        getDocs(buildAdminTeamPrefixQuery(teamsRef, strategy))
    ));
    const candidates = snapshots.flatMap((snapshot) =>
        snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    );
    return mergeAdminTeamSearchResults([], candidates, searchTerm);
}

export function resolveAdminTeamSearchResult(pageTeams = [], result = {}) {
    if (result.stale) return null;
    if (!result.remote) return pageTeams;
    return mergeAdminTeamSearchResults(pageTeams, result.teams, result.term);
}

export function createDebouncedAdminTeamSearch({
    search = searchAdminTeams,
    debounceMs = ADMIN_TEAM_SEARCH_DEBOUNCE_MS
} = {}) {
    let generation = 0;
    let pendingTimer = null;
    let settlePending = null;

    return function runAdminTeamSearch(value = '') {
        const term = normalizeAdminTeamSearchTerm(value);
        const requestGeneration = ++generation;

        if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
            settlePending?.({ term, teams: [], stale: true, remote: false });
            settlePending = null;
        }

        if (!shouldRunRemoteAdminTeamSearch(term)) {
            return Promise.resolve({ term, teams: [], stale: false, remote: false });
        }

        return new Promise((resolve, reject) => {
            settlePending = resolve;
            pendingTimer = setTimeout(async () => {
                pendingTimer = null;
                settlePending = null;
                try {
                    const teams = await search(term);
                    resolve({
                        term,
                        teams: Array.isArray(teams) ? teams.slice(0, ADMIN_TEAM_SEARCH_RESULT_LIMIT) : [],
                        stale: requestGeneration !== generation,
                        remote: true
                    });
                } catch (error) {
                    if (requestGeneration !== generation) {
                        resolve({ term, teams: [], stale: true, remote: true });
                        return;
                    }
                    reject(error);
                }
            }, debounceMs);
        });
    };
}
