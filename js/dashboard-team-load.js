import { auth, functions, httpsCallable } from './firebase.js?v=26';
import { getPrimaryAppCheckHeaders } from './firebase-app-check-rest.js?v=1';
import { filterTeamsByActive } from './team-visibility.js?v=2';

const DASHBOARD_TEAM_LOAD_VERSION = 1;
const DASHBOARD_TEAM_HTTP_HEDGE_DELAY_MS = 750;
const DEFAULT_DASHBOARD_TEAM_TIMEOUT_MS = 10000;

function withDeadline(operation, timeoutMs, onTimeout) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            onTimeout?.();
            reject(new Error('Dashboard team discovery timed out.'));
        }, timeoutMs);
    });
    return Promise.race([operation, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function normalizeTeamList(value) {
    const teamsById = new Map();
    (Array.isArray(value) ? value : []).forEach((team) => {
        if (!team || typeof team !== 'object' || Array.isArray(team)) return;
        const teamId = String(team.id || '').trim();
        if (!teamId || teamId.includes('/')) return;
        teamsById.set(teamId, team);
    });
    return filterTeamsByActive(Array.from(teamsById.values()))
        .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
}

function requireCompleteDashboardTeamResult(result, { includeAllTeams }) {
    if (
        result?.dashboardTeamLoadVersion !== DASHBOARD_TEAM_LOAD_VERSION
        || !Array.isArray(result?.items)
        || !Array.isArray(result?.parentItems)
    ) {
        const error = new Error('Dashboard teams response is invalid.');
        error.code = 'dashboard-team-discovery-invalid';
        throw error;
    }
    if (includeAllTeams && result.includesAllTeams !== true) {
        const error = new Error('Dashboard teams response did not include every team.');
        error.code = 'dashboard-team-discovery-incomplete-admin';
        throw error;
    }

    const fullAccessTeams = normalizeTeamList(result.items);
    const fullAccessTeamIds = new Set(fullAccessTeams.map((team) => team.id));
    const parentTeams = normalizeTeamList(result.parentItems)
        .filter((team) => !fullAccessTeamIds.has(team.id));
    if (result.isPartial === true) {
        const error = new Error('Dashboard team discovery returned partial results.');
        error.code = 'dashboard-team-discovery-partial';
        error.partialResult = { fullAccessTeams, parentTeams };
        throw error;
    }
    return { fullAccessTeams, parentTeams };
}

async function fetchDashboardTeamsViaRest(requestData, abortSignal) {
    const user = auth.currentUser;
    if (!user) throw new Error('Sign in to load your teams.');
    const token = await user.getIdToken();
    const projectId = auth.app?.options?.projectId;
    if (!projectId) throw new Error('Firebase project ID is not configured.');
    const requestUrl = `https://us-central1-${projectId}.cloudfunctions.net/listManagedTeams`;
    const response = await fetch(requestUrl, {
        method: 'POST',
        headers: await getPrimaryAppCheckHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }, requestUrl),
        body: JSON.stringify({ data: requestData }),
        signal: abortSignal
    });
    const payload = await response.json().catch(() => ({}));
    const result = payload.result || payload.data;
    if (!response.ok || payload.error) {
        throw new Error(payload.error?.message || 'Dashboard teams request failed.');
    }
    return result;
}

async function raceDashboardTeamDiscovery(callPromise, requestData, includeAllTeams, abortSignal) {
    let hedgeTimerId;
    let hedgePromise = null;
    const normalize = (result) => requireCompleteDashboardTeamResult(result, { includeAllTeams });
    const completeCallPromise = callPromise.then(normalize);
    const hedgeAfterDelay = new Promise((resolve) => {
        hedgeTimerId = setTimeout(() => {
            hedgePromise = fetchDashboardTeamsViaRest(requestData, abortSignal).then(normalize);
            resolve(hedgePromise);
        }, DASHBOARD_TEAM_HTTP_HEDGE_DELAY_MS);
    });

    try {
        return await Promise.any([completeCallPromise, hedgeAfterDelay]);
    } catch (aggregateError) {
        const errors = Array.isArray(aggregateError?.errors) ? aggregateError.errors : [];
        const partialError = errors.find((error) => error?.code === 'dashboard-team-discovery-partial');
        throw partialError || errors[0] || aggregateError;
    } finally {
        clearTimeout(hedgeTimerId);
        if (hedgePromise) hedgePromise.catch(() => {});
    }
}

export async function loadDashboardTeams(options = {}) {
    if (!auth.currentUser) throw new Error('Sign in to load your teams.');
    const includeAllTeams = options.includeAllTeams === true;
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_DASHBOARD_TEAM_TIMEOUT_MS;
    const requestData = {
        includeParentTeams: true,
        ...(includeAllTeams ? { includeAllTeams: true } : {})
    };
    const callable = httpsCallable(functions, 'listManagedTeams');
    const callPromise = callable(requestData).then((response) => response?.data);
    const abortController = new AbortController();
    const racePromise = raceDashboardTeamDiscovery(
        callPromise,
        requestData,
        includeAllTeams,
        abortController.signal
    );
    try {
        return await withDeadline(racePromise, timeoutMs, () => abortController.abort());
    } finally {
        abortController.abort();
    }
}
