import {
    getAdminTeamsPage,
    getAdminUsersPage,
    getTeams,
    getAllUsers,
    getGames,
    getOfficials,
    getOfficialsForUsers,
    addOfficial,
    updateOfficial,
    deleteOfficial,
    deleteTeam,
    getTelemetryEvents,
    getTelemetryDaily,
    getTelemetryPageDaily,
    getTelemetryRouteDaily,
    getTelemetryEventDaily,
    getTelemetrySessions
} from './db.js?v=91';
import { db, collection, getDocs, doc, setDoc, updateDoc, serverTimestamp, getCountFromServer, query, where } from './firebase.js?v=20';
import { renderHeader, renderFooter, escapeHtml } from './utils.js?v=8';
import { checkAuth } from './auth.js?v=46';
import { DEFAULT_ADMIN_PAGE_SIZE, loadAdminCollectionPage, loadInitialAdminBootstrap } from './admin-bootstrap.js?v=1';
import {
    adminRegistrationDefaults,
    buildAdminRegistrationFormPayload,
    formatFieldLabels,
    formatRegistrationDiscountRulesText,
    parseRegistrationDiscountRulesText,
    getAdminRegistrationShareUrl,
    validateAdminRegistrationFormPayload
} from './admin-registration-forms.js?v=3';
import { buildRecentGameResultsRows } from './admin-game-results.js?v=1';
import {
    buildOfficialLookupCacheKey,
    buildOfficialUserLookup,
    formatOfficialUserSummary,
    getOfficialUserSummary,
    matchesOfficialUserSearch
} from './admin-user-official-links.js?v=2';
import { buildAdminTeamOfficialsSummary } from './admin-team-officials.js?v=1';
import {
    hasAdminGlobalSearchTerm,
    normalizeAdminSearchTerm,
    selectAdminItemById,
    selectAdminSearchCollection
} from './admin-search.js?v=1';
import {
    buildTrackedWorkflowLoadSummary,
    buildTelemetryPerformanceSummary,
    formatPerformanceDuration
} from './telemetry-performance.js?v=3';

let allTeams = [];
let allUsers = [];
let globalSearchTeams = [];
let globalSearchUsers = [];
let dashboardTeams = [];
let dashboardUsers = [];
let officialUserLookup = new Map();
let officialsByTeamId = new Map();
let currentUser = null; // Declare currentUser
let showInactiveTeams = false;
let activeOfficialsTeam = null;
let activeOfficials = [];
let activeRegistrationTeam = null;
let activeRegistrationForms = [];
let activeRegistrationOptions = [];
let activeTab = 'dashboard';

const teamPageState = {
    pageSize: DEFAULT_ADMIN_PAGE_SIZE,
    pages: [],
    currentIndex: 0,
    nextCursor: null,
    loading: false
};

const userPageState = {
    pageSize: DEFAULT_ADMIN_PAGE_SIZE,
    pages: [],
    currentIndex: 0,
    nextCursor: null,
    loading: false
};

let loadedGamesPageKey = '';
let loadedDashboardGamesKey = '';
let loadedTeamsOfficialsPageKey = '';
let loadedUsersOfficialsKey = '';
let globalSearchTeamsLoaded = false;
let globalSearchUsersLoaded = false;
let globalSearchTeamsPromise = null;
let globalSearchUsersPromise = null;

function getCurrentTeamPage() {
    return teamPageState.pages[teamPageState.currentIndex] || [];
}

function getCurrentUsersPage() {
    return userPageState.pages[userPageState.currentIndex] || [];
}

function getTeamsKey(teams = []) {
    return teams.map((team) => team.id).join('|');
}

function getCurrentTeamPageKey() {
    return getTeamsKey(getCurrentTeamPage());
}

function getTeamNameById(teamId) {
    const team = getDashboardTeams().find((entry) => entry.id === teamId)
        || allTeams.find((entry) => entry.id === teamId);
    return team?.name || 'Team';
}

function getDashboardTeams() {
    return dashboardTeams.length ? dashboardTeams : allTeams;
}

function getDashboardUsers() {
    return dashboardUsers.length ? dashboardUsers : allUsers;
}

function getAdminTeamById(teamId) {
    return selectAdminItemById({
        id: teamId,
        pageItems: allTeams,
        globalItems: globalSearchTeams,
        fallbackItems: dashboardTeams
    });
}

function applyCurrentTeamPage() {
    allTeams = getCurrentTeamPage();
}

function applyCurrentUsersPage() {
    allUsers = getCurrentUsersPage();
}

function resetGlobalAdminSearchCollections() {
    globalSearchTeams = [];
    globalSearchUsers = [];
    globalSearchTeamsLoaded = false;
    globalSearchUsersLoaded = false;
    globalSearchTeamsPromise = null;
    globalSearchUsersPromise = null;
}

async function ensureGlobalAdminTeamsForSearch() {
    if (globalSearchTeamsLoaded) return globalSearchTeams;
    if (!globalSearchTeamsPromise) {
        globalSearchTeamsPromise = getTeams({ includeInactive: true })
            .then((teams) => {
                globalSearchTeams = Array.isArray(teams) ? teams : [];
                globalSearchTeamsLoaded = true;
                return globalSearchTeams;
            })
            .finally(() => {
                globalSearchTeamsPromise = null;
            });
    }
    return globalSearchTeamsPromise;
}

async function ensureGlobalAdminUsersForSearch() {
    if (globalSearchUsersLoaded) return globalSearchUsers;
    if (!globalSearchUsersPromise) {
        globalSearchUsersPromise = getAllUsers()
            .then((users) => {
                globalSearchUsers = Array.isArray(users) ? users : [];
                globalSearchUsersLoaded = true;
                return globalSearchUsers;
            })
            .finally(() => {
                globalSearchUsersPromise = null;
            });
    }
    return globalSearchUsersPromise;
}

async function getAdminTeamsForSearch(searchTerm = '') {
    if (hasAdminGlobalSearchTerm(searchTerm)) {
        await ensureGlobalAdminTeamsForSearch();
    }
    return selectAdminSearchCollection({
        searchTerm,
        pageItems: allTeams,
        globalItems: globalSearchTeams
    });
}

async function getAdminUsersForSearch(searchTerm = '') {
    if (hasAdminGlobalSearchTerm(searchTerm)) {
        await ensureGlobalAdminUsersForSearch();
    }
    return selectAdminSearchCollection({
        searchTerm,
        pageItems: allUsers,
        globalItems: globalSearchUsers
    });
}

function setTeamsPage(page, nextCursor, index = 0) {
    teamPageState.pages[index] = page;
    teamPageState.currentIndex = index;
    teamPageState.nextCursor = nextCursor;
    applyCurrentTeamPage();
    updateTeamsPaginationControls();
}

function setUsersPage(page, nextCursor, index = 0) {
    userPageState.pages[index] = page;
    userPageState.currentIndex = index;
    userPageState.nextCursor = nextCursor;
    applyCurrentUsersPage();
    updateUsersPaginationControls();
}

function updateTeamsPaginationControls() {
    const status = document.getElementById('teams-pagination-status');
    const prev = document.getElementById('teams-prev-page');
    const next = document.getElementById('teams-next-page');
    if (status) {
        status.textContent = `Teams page ${teamPageState.currentIndex + 1} · ${allTeams.length} loaded`;
    }
    if (prev) {
        prev.disabled = teamPageState.loading || teamPageState.currentIndex === 0;
    }
    if (next) {
        next.disabled = teamPageState.loading || (teamPageState.currentIndex >= teamPageState.pages.length - 1 && !teamPageState.nextCursor);
    }
}

function updateUsersPaginationControls() {
    const status = document.getElementById('users-pagination-status');
    const prev = document.getElementById('users-prev-page');
    const next = document.getElementById('users-next-page');
    if (status) {
        status.textContent = `Users page ${userPageState.currentIndex + 1} · ${allUsers.length} loaded`;
    }
    if (prev) {
        prev.disabled = userPageState.loading || userPageState.currentIndex === 0;
    }
    if (next) {
        next.disabled = userPageState.loading || (userPageState.currentIndex >= userPageState.pages.length - 1 && !userPageState.nextCursor);
    }
}

function inlineJsString(value) {
    return escapeHtml(JSON.stringify(String(value || '')));
}

function splitDirectoryInput(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

let telemetryState = {
    loaded: false,
    loading: false,
    error: null,
    days: 7,
    events: [],
    daily: [],
    pages: [],
    routes: [],
    eventDaily: [],
    sessions: []
};

const telemetryIssueEvents = [
    { name: 'js_error', label: 'JS errors' },
    { name: 'js_unhandled_rejection', label: 'Unhandled rejections' },
    { name: 'interaction_rage_click', label: 'Rage clicks' }
];

function isTeamActive(team) {
    return team?.active !== false;
}

function getVisibleTeams() {
    return showInactiveTeams ? allTeams : allTeams.filter(isTeamActive);
}

function canCurrentUserDeactivateTeam(team) {
    if (!currentUser || !team) return false;
    if (team.ownerId && currentUser.uid) {
        return team.ownerId === currentUser.uid;
    }
    if (team.ownerEmail && currentUser.email) {
        return team.ownerEmail.trim().toLowerCase() === currentUser.email.trim().toLowerCase();
    }
    return false;
}

checkAuth(async (user) => {
    if (!user) {
        window.location.href = 'login.html';
        return;
    }
    // Check if user is admin
    if (!user.isAdmin) {
        window.location.href = 'dashboard.html';
        return;
    }
    currentUser = user;
    renderHeader(document.getElementById('header-container'), user);
    renderFooter(document.getElementById('footer-container'));
    document.getElementById('admin-email').textContent = user.email;

    await loadData();
    setupTabs();
    setupSearch();
});

async function loadData() {
    try {
        loadedGamesPageKey = '';
        loadedDashboardGamesKey = '';
        loadedTeamsOfficialsPageKey = '';
        loadedUsersOfficialsKey = '';
        allGames = [];
        dashboardGames = [];
        dashboardGameStatsByTeamId = new Map();
        dashboardTeams = [];
        dashboardUsers = [];
        resetGlobalAdminSearchCollections();
        officialUserLookup = new Map();
        officialsByTeamId = new Map();

        const { teamsPage, usersPage, telemetryPromise } = await loadInitialAdminBootstrap({
            getTeamsPage: getAdminTeamsPage,
            getUsersPage: getAdminUsersPage,
            loadTelemetryData
        });

        setTeamsPage(teamsPage.teams, teamsPage.nextCursor);
        setUsersPage(usersPage.users, usersPage.nextCursor);

        await Promise.all([
            ensureCurrentTeamGamesLoaded(),
            loadDashboardData()
        ]);
        telemetryPromise.then(() => {
            if (activeTab === 'telemetry') {
                updateTelemetryDashboard();
            }
        });

        updateDashboard();
        renderTeams(getVisibleTeams());
        renderUsers(allUsers);
        updateTelemetryDashboard();
    } catch (error) {
        console.error('Error loading admin data:', error);
        alert('Failed to load data');
    }
}

let allGames = [];
let dashboardGames = [];
let dashboardGameStatsByTeamId = new Map();

const DASHBOARD_GAME_LOOKBACK_DAYS = 30;
const DASHBOARD_GAME_LOOKAHEAD_DAYS = 30;

function buildDashboardGameQueryWindow(referenceDate = new Date()) {
    const startDate = new Date(referenceDate.getTime() - DASHBOARD_GAME_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const endDate = new Date(referenceDate.getTime() + DASHBOARD_GAME_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    return { startDate, endDate };
}

async function loadOfficialUserLinks(teams = allTeams, { scope = 'page' } = {}) {
    const teamsKey = getTeamsKey(teams);
    if (scope === 'page' && teamsKey && loadedTeamsOfficialsPageKey === teamsKey) {
        return;
    }
    if (scope === 'all' && teamsKey && loadedUsersOfficialsKey === teamsKey) {
        return;
    }

    const officialEntries = (await Promise.all(teams.map(async (team) => {
        try {
            const officials = await getOfficials(team.id);
            officialsByTeamId.set(team.id, officials);
            return officials.map((official) => ({
                teamId: team.id,
                teamName: team.name || 'Team',
                official
            }));
        } catch (error) {
            officialsByTeamId.set(team.id, []);
            console.warn('Failed to load officials for admin users view:', team.id, error);
            return [];
        }
    }))).flat();

    if (scope === 'all') {
        officialUserLookup = buildOfficialUserLookup(officialEntries);
        loadedUsersOfficialsKey = teamsKey;
        return;
    }

    loadedTeamsOfficialsPageKey = teamsKey;
}

async function loadVisibleOfficialUserLinks(users = allUsers) {
    const usersKey = buildOfficialLookupCacheKey(users);
    if (!usersKey) {
        officialUserLookup = new Map();
        loadedUsersOfficialsKey = '';
        return;
    }
    if (usersKey && loadedUsersOfficialsKey === usersKey) {
        return;
    }

    const officialEntries = await getOfficialsForUsers(users);
    officialUserLookup = buildOfficialUserLookup(officialEntries.map((entry) => ({
        ...entry,
        teamName: getTeamNameById(entry.teamId)
    })));
    loadedUsersOfficialsKey = usersKey;
}

async function loadDashboardAllTimeGameStats(teams = []) {
    const statsEntries = await Promise.all(teams.map(async (team) => {
        try {
            const gamesRef = collection(db, 'teams', team.id, 'games');
            const [totalSnapshot, completedSnapshot, scheduledSnapshot] = await Promise.all([
                getCountFromServer(gamesRef),
                getCountFromServer(query(gamesRef, where('status', '==', 'completed'))),
                getCountFromServer(query(gamesRef, where('status', '==', 'scheduled')))
            ]);
            const total = totalSnapshot.data().count || 0;
            return [team.id, {
                total,
                completed: completedSnapshot.data().count || 0,
                scheduled: scheduledSnapshot.data().count || 0
            }];
        } catch (error) {
            console.warn('Failed to load all-time game stats for admin dashboard:', team.id, error);
            return [team.id, { total: 0, completed: 0, scheduled: 0 }];
        }
    }));
    dashboardGameStatsByTeamId = new Map(statsEntries);
}

async function loadGameStatsForTeams(teams = allTeams, { scope = 'page' } = {}) {
    const teamsKey = getTeamsKey(teams);
    if (scope === 'page' && teamsKey && loadedGamesPageKey === teamsKey) {
        return;
    }
    if (scope === 'dashboard' && teamsKey && loadedDashboardGamesKey === teamsKey) {
        return;
    }

    const dashboardGameQueryWindow = scope === 'dashboard'
        ? buildDashboardGameQueryWindow()
        : null;
    const gamesPromises = teams.map(async (team) => {
        try {
            const games = dashboardGameQueryWindow
                ? await getGames(team.id, dashboardGameQueryWindow)
                : await getGames(team.id);
            return games.map(g => ({ ...g, teamId: team.id, teamName: team.name }));
        } catch (e) {
            return [];
        }
    });
    const gamesArrays = await Promise.all(gamesPromises);
    const nextGames = gamesArrays.flat();

    if (scope === 'dashboard') {
        dashboardGames = nextGames;
        await loadDashboardAllTimeGameStats(teams);
        loadedDashboardGamesKey = teamsKey;
        return;
    }

    allGames = nextGames;
    loadedGamesPageKey = teamsKey;
}

async function loadDashboardData() {
    dashboardTeams = await getTeams({ includeInactive: true });
    dashboardUsers = await getAllUsers();
    globalSearchTeams = dashboardTeams;
    globalSearchUsers = dashboardUsers;
    globalSearchTeamsLoaded = true;
    globalSearchUsersLoaded = true;
    await loadGameStatsForTeams(dashboardTeams, { scope: 'dashboard' });
}

async function ensureCurrentTeamGamesLoaded() {
    await loadGameStatsForTeams(getCurrentTeamPage(), { scope: 'page' });
}

async function ensureCurrentTeamOfficialsLoaded() {
    await loadOfficialUserLinks(getCurrentTeamPage(), { scope: 'page' });
}

async function ensureCurrentUsersOfficialsLoaded() {
    await loadVisibleOfficialUserLinks(getCurrentUsersPage());
}

function getTelemetryRangeDays() {
    const select = document.getElementById('telemetry-range');
    return Number(select?.value || telemetryState.days || 7);
}

async function loadTelemetryData({ silent = false } = {}) {
    if (telemetryState.loading) return;

    telemetryState.loading = true;
    telemetryState.days = getTelemetryRangeDays();
    const status = document.getElementById('telemetry-status');
    if (status && !silent) {
        status.textContent = 'Loading telemetry...';
    }

    try {
        const days = telemetryState.days;
        const maxEvents = days <= 1 ? 1000 : days <= 7 ? 2000 : 5000;
        const [events, daily, pages, routes, eventDaily, sessions] = await Promise.all([
            getTelemetryEvents({ days, maxEvents }),
            getTelemetryDaily({ days }),
            getTelemetryPageDaily({ days }),
            getTelemetryRouteDaily({ days }),
            getTelemetryEventDaily({ days }),
            getTelemetrySessions({ maxSessions: 300 })
        ]);

        telemetryState = {
            loaded: true,
            loading: false,
            days,
            events,
            daily,
            pages,
            routes,
            eventDaily,
            sessions
        };
        if (status) {
            status.textContent = `Loaded ${events.length.toLocaleString()} recent raw events plus aggregate summaries.`;
        }
    } catch (error) {
        console.error('Error loading telemetry:', error);
        telemetryState = {
            ...telemetryState,
            loading: false,
            loaded: false,
            error: error.message || 'Telemetry could not be loaded',
            events: [],
            daily: [],
            pages: [],
            routes: [],
            eventDaily: [],
            sessions: []
        };
        if (status) {
            status.textContent = `Telemetry could not be loaded: ${error.message}`;
        }
    }
}

function updateDashboard() {
    const sourceTeams = getDashboardTeams();
    const sourceUsers = getDashboardUsers();
    const visibleTeams = showInactiveTeams ? sourceTeams : sourceTeams.filter(isTeamActive);
    const visibleTeamIds = new Set(visibleTeams.map(team => team.id));
    const visibleRecentGames = dashboardGames.filter(game => visibleTeamIds.has(game.teamId));
    const visibleAllTimeGameStats = visibleTeams.reduce((totals, team) => {
        const stats = dashboardGameStatsByTeamId.get(team.id) || { total: 0, completed: 0, scheduled: 0 };
        totals.total += stats.total;
        totals.completed += stats.completed;
        totals.scheduled += stats.scheduled;
        if (stats.total > 0) totals.teamsWithGames += 1;
        return totals;
    }, { total: 0, completed: 0, scheduled: 0, teamsWithGames: 0 });
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Total teams with growth
    const newTeamsLast30 = visibleTeams.filter(t => t.createdAt && t.createdAt.toDate() > thirtyDaysAgo).length;
    document.getElementById('stat-total-teams').textContent = visibleTeams.length;
    document.getElementById('stat-teams-growth').textContent = `+${newTeamsLast30} this month`;

    // Total users with growth
    const newUsersLast30 = sourceUsers.filter(u => u.createdAt && u.createdAt.toDate() > thirtyDaysAgo).length;
    document.getElementById('stat-total-users').textContent = sourceUsers.length;
    document.getElementById('stat-users-growth').textContent = `+${newUsersLast30} this month`;

    // Total games
    const completedGames = visibleAllTimeGameStats.completed;
    const scheduledGames = visibleAllTimeGameStats.scheduled;
    document.getElementById('stat-total-games').textContent = visibleAllTimeGameStats.total;
    document.getElementById('stat-games-breakdown').textContent = `${completedGames} played, ${scheduledGames} scheduled`;
    renderRecentGameResults(visibleRecentGames);

    // Activity (teams with games in last 7 days)
    const activeTeams = new Set(visibleRecentGames.filter(g => {
        const gameDate = g.date.toDate ? g.date.toDate() : new Date(g.date);
        return gameDate > sevenDaysAgo;
    }).map(g => g.teamId)).size;
    document.getElementById('stat-active-teams').textContent = activeTeams;
    document.getElementById('stat-activity-detail').textContent = `${activeTeams} teams with games`;

    // By Sport
    const sportCounts = {};
    visibleTeams.forEach(t => {
        const sport = t.sport || 'Unknown';
        sportCounts[sport] = (sportCounts[sport] || 0) + 1;
    });
    document.getElementById('stat-by-sport').innerHTML = Object.entries(sportCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([sport, count]) => `
            <div class="flex justify-between items-center">
                <span class="text-gray-700">${escapeHtml(sport)}</span>
                <span class="font-semibold text-gray-900">${count}</span>
            </div>
        `).join('');

    // Team details
    const publicTeams = visibleTeams.filter(t => t.isPublic !== false).length;
    const privateTeams = visibleTeams.length - publicTeams;
    const teamsWithGames = visibleAllTimeGameStats.teamsWithGames;
    document.getElementById('stat-team-details').innerHTML = `
        <div class="flex justify-between items-center">
            <span class="text-gray-700">Public</span>
            <span class="font-semibold text-gray-900">${publicTeams}</span>
        </div>
        <div class="flex justify-between items-center">
            <span class="text-gray-700">Private</span>
            <span class="font-semibold text-gray-900">${privateTeams}</span>
        </div>
        <div class="flex justify-between items-center">
            <span class="text-gray-700">With Games</span>
            <span class="font-semibold text-gray-900">${teamsWithGames}</span>
        </div>
    `;

    // Recent teams
    const recentTeams = [...visibleTeams]
        .sort((a, b) => {
            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
            return dateB - dateA;
        })
        .slice(0, 10);

    document.getElementById('recent-teams').innerHTML = recentTeams.map(team => `
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
            <div class="flex items-center gap-3">
                ${team.photoUrl
                    ? `<img src="${escapeHtml(team.photoUrl)}" class="w-10 h-10 rounded-full object-cover" alt="">`
                    : `<div class="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">${escapeHtml(team.name.charAt(0))}</div>`
                }
                <div>
                    <p class="font-medium text-gray-900">${escapeHtml(team.name)}</p>
                    <p class="text-xs text-gray-500">${escapeHtml(team.sport || 'Unknown')} • ${team.createdAt?.toDate ? team.createdAt.toDate().toLocaleDateString() : 'Unknown date'}</p>
                </div>
            </div>
            <a href="edit-team.html?teamId=${team.id}" class="text-xs text-indigo-600 hover:text-indigo-800">View →</a>
        </div>
    `).join('');

    // Recent users
    const recentUsersList = [...sourceUsers]
        .sort((a, b) => {
            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
            return dateB - dateA;
        })
        .slice(0, 10);

    document.getElementById('recent-users').innerHTML = recentUsersList.map(user => `
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
                <p class="font-medium text-gray-900">${escapeHtml(user.email || 'No email')}</p>
                <p class="text-xs text-gray-500">${escapeHtml(user.fullName || 'No name')} • ${user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString() : 'Unknown date'}</p>
            </div>
            ${user.isAdmin ? '<span class="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full font-semibold">Admin</span>' : ''}
        </div>
    `).join('');
}

function renderRecentGameResults(visibleGames) {
    const container = document.getElementById('recent-game-results');
    if (!container) return;

    const rows = buildRecentGameResultsRows(visibleGames, { limit: 10 });
    if (!rows.length) {
        container.innerHTML = '<p class="text-sm text-gray-500">No completed or scored game results yet.</p>';
        return;
    }

    container.innerHTML = `
        <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 text-sm">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-3 py-2 text-left font-semibold text-gray-600">Date</th>
                        <th class="px-3 py-2 text-left font-semibold text-gray-600">Team</th>
                        <th class="px-3 py-2 text-left font-semibold text-gray-600">Opponent</th>
                        <th class="px-3 py-2 text-left font-semibold text-gray-600">Score</th>
                        <th class="px-3 py-2 text-left font-semibold text-gray-600">Status</th>
                        <th class="px-3 py-2 text-left font-semibold text-gray-600">Report</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 bg-white">
                    ${rows.map(row => {
                        const reportHref = row.teamId && row.gameId
                            ? `game.html#teamId=${encodeURIComponent(row.teamId)}&gameId=${encodeURIComponent(row.gameId)}`
                            : '';
                        return `
                            <tr>
                                <td class="px-3 py-2 text-gray-600 whitespace-nowrap">${escapeHtml(row.dateLabel)}</td>
                                <td class="px-3 py-2 font-medium text-gray-900">${escapeHtml(row.teamName)}</td>
                                <td class="px-3 py-2 text-gray-700">${escapeHtml(row.opponent)}</td>
                                <td class="px-3 py-2 font-semibold text-gray-900 whitespace-nowrap">${escapeHtml(row.score)}</td>
                                <td class="px-3 py-2 text-gray-700">${escapeHtml(row.status)}</td>
                                <td class="px-3 py-2 whitespace-nowrap">
                                    ${reportHref
                                        ? `<a href="${reportHref}" class="text-indigo-600 hover:text-indigo-800 font-medium">Game Report →</a>`
                                        : '<span class="text-gray-400">Unavailable</span>'
                                    }
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function telemetryDate(value) {
    if (!value) return null;
    if (value.toDate) return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function telemetryNumber(value) {
    return Number(value || 0).toLocaleString();
}

function sumBy(items, key) {
    return items.reduce((sum, item) => sum + Number(item[key] || 0), 0);
}

function groupTelemetry(items, key, countKey = 'count') {
    const grouped = new Map();
    items.forEach((item) => {
        const groupKey = item[key] || 'Unknown';
        const current = grouped.get(groupKey) || { key: groupKey, count: 0, item };
        current.count += Number(item[countKey] || 0);
        grouped.set(groupKey, current);
    });
    return Array.from(grouped.values()).sort((a, b) => b.count - a.count);
}

function getTelemetryRoute(event) {
    const props = event.properties || {};
    return event.appRoute ||
        props.completedRoute ||
        props.targetRoute ||
        props.route ||
        props.appRoute ||
        event.pagePath ||
        '-';
}

function getFilteredTelemetryEvents() {
    const eventFilter = document.getElementById('telemetry-event-filter')?.value || '';
    const pageFilter = (document.getElementById('telemetry-page-filter')?.value || '').toLowerCase();
    return telemetryState.events.filter((event) => {
        const eventMatches = !eventFilter || event.name === eventFilter;
        const route = String(getTelemetryRoute(event)).toLowerCase();
        const pageMatches = !pageFilter || route.includes(pageFilter) || (event.pagePath || '').toLowerCase().includes(pageFilter);
        return eventMatches && pageMatches;
    });
}

function getTelemetryTarget(event) {
    const props = event.properties || {};
    return props.telemetryName || props.label || props.elementId || props.formId || props.tagName || '-';
}

function renderMetric(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = telemetryNumber(value);
}

function renderEmptyTelemetry(id, message = 'No telemetry yet.') {
    const element = document.getElementById(id);
    if (element) {
        element.innerHTML = `<p class="text-gray-400 text-sm">${escapeHtml(message)}</p>`;
    }
}

function renderTelemetryList(id, rows, renderer, emptyMessage) {
    const element = document.getElementById(id);
    if (!element) return;
    if (!rows.length) {
        renderEmptyTelemetry(id, emptyMessage);
        return;
    }
    element.innerHTML = rows.map(renderer).join('');
}

function renderTelemetryTrend() {
    const rows = [...telemetryState.daily].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const maxEvents = Math.max(...rows.map((row) => Number(row.totalEvents || 0)), 1);
    renderTelemetryList('telemetry-daily-trend', rows, (row) => {
        const total = Number(row.totalEvents || 0);
        const width = Math.max(4, Math.round((total / maxEvents) * 100));
        return `
            <div>
                <div class="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>${escapeHtml(row.date || '-')}</span>
                    <span>${telemetryNumber(total)} events · ${telemetryNumber(row.pageViews)} views</span>
                </div>
                <div class="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div class="h-full bg-primary-600 rounded-full" style="width: ${width}%"></div>
                </div>
            </div>
        `;
    }, 'No daily telemetry has been recorded for this range.');
}

function renderTopTelemetryPages() {
    const grouped = groupTelemetry(telemetryState.pages, 'pagePath', 'pageViews').slice(0, 20);
    renderTelemetryList('telemetry-top-pages', grouped, ({ key, count, item }) => `
        <div class="flex items-center justify-between gap-3 border-b border-gray-100 pb-2 last:border-0">
            <div class="min-w-0">
                <p class="font-medium text-gray-900 truncate">${escapeHtml(key)}</p>
                <p class="text-xs text-gray-500">${telemetryNumber(item.interactions)} interactions · ${telemetryNumber(item.errors)} errors</p>
            </div>
            <span class="text-sm font-semibold text-gray-900">${telemetryNumber(count)}</span>
        </div>
    `, 'No page telemetry has been recorded for this range.');
}

function renderTopTelemetryRoutes() {
    const grouped = groupTelemetry(telemetryState.routes, 'appRoute', 'totalEvents').slice(0, 20);
    renderTelemetryList('telemetry-top-routes', grouped, ({ key, count, item }) => `
        <div class="flex items-center justify-between gap-3 border-b border-gray-100 pb-2 last:border-0">
            <div class="min-w-0">
                <p class="font-medium text-gray-900 truncate">${escapeHtml(key)}</p>
                <p class="text-xs text-gray-500">${telemetryNumber(item.pageViews)} views · ${telemetryNumber(item.interactions)} interactions · ${telemetryNumber(item.errors)} errors</p>
            </div>
            <span class="text-sm font-semibold text-gray-900">${telemetryNumber(count)}</span>
        </div>
    `, 'No app route telemetry has been recorded for this range.');
}

function renderTopTelemetryEvents() {
    const grouped = groupTelemetry(telemetryState.eventDaily, 'name', 'count').slice(0, 20);
    renderTelemetryList('telemetry-top-events', grouped, ({ key, count }) => `
        <div class="flex items-center justify-between gap-3 border-b border-gray-100 pb-2 last:border-0">
            <span class="text-sm font-medium text-gray-800 truncate">${escapeHtml(key)}</span>
            <span class="text-sm font-semibold text-gray-900">${telemetryNumber(count)}</span>
        </div>
    `, 'No event telemetry has been recorded for this range.');
}

function getTelemetryIssueCounts() {
    const issueCounts = new Map(telemetryIssueEvents.map(({ name }) => [name, 0]));
    telemetryState.eventDaily.forEach((row) => {
        if (!issueCounts.has(row.name)) return;
        issueCounts.set(row.name, issueCounts.get(row.name) + Number(row.count || 0));
    });
    return issueCounts;
}

function renderTelemetryNeedsAttention() {
    const element = document.getElementById('telemetry-needs-attention');
    if (!element) return;

    const issueCounts = getTelemetryIssueCounts();
    const issueEvents = telemetryState.events.filter((event) => issueCounts.has(event.name));
    const totalIssues = Array.from(issueCounts.values()).reduce((sum, count) => sum + count, 0);
    const countCards = telemetryIssueEvents.map(({ name, label }) => `
        <div class="rounded-lg border border-gray-200 p-4">
            <p class="text-xs font-semibold text-gray-500 uppercase">${escapeHtml(label)}</p>
            <p class="text-2xl font-bold text-gray-900 mt-1">${telemetryNumber(issueCounts.get(name))}</p>
        </div>
    `).join('');

    if (!totalIssues) {
        element.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">${countCards}</div>
            <p class="text-sm text-gray-500">No errors or rage clicks recorded for this range.</p>
        `;
        return;
    }

    const recentRows = issueEvents
        .slice(0, 5)
        .map((event) => {
            const createdAt = telemetryDate(event.createdAt) || telemetryDate(event.clientTimestamp);
            const route = getTelemetryRoute(event);
            return `
                <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-1 border-b border-gray-100 pb-2 last:border-0">
                    <div class="min-w-0">
                        <p class="text-sm font-medium text-gray-900 truncate">${escapeHtml(event.name || '-')} · ${escapeHtml(route)}</p>
                        <p class="text-xs text-gray-500 truncate">Target: ${escapeHtml(getTelemetryTarget(event))}</p>
                    </div>
                    <span class="text-xs text-gray-500 whitespace-nowrap">${createdAt ? createdAt.toLocaleString() : '-'}</span>
                </div>
            `;
        })
        .join('') || '<p class="text-sm text-gray-500">No recent raw examples loaded for this range.</p>';

    element.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">${countCards}</div>
        <div>
            <p class="text-xs font-semibold text-gray-500 uppercase mb-2">Recent examples</p>
            <div class="space-y-2">${recentRows}</div>
        </div>
    `;
}

function setTelemetryText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function renderTelemetryPerformanceEmpty(message = 'No app performance telemetry has been recorded for this range.') {
    setTelemetryText('telemetry-performance-samples', '0');
    setTelemetryText('telemetry-performance-p50', '-');
    setTelemetryText('telemetry-performance-p95', '-');
    setTelemetryText('telemetry-performance-slow', '0');
    renderEmptyTelemetry('telemetry-performance-groups', message);
    renderEmptyTelemetry('telemetry-performance-slow-events', message);
    renderEmptyTelemetry('telemetry-performance-tracked-workflows', message);
}

function renderTelemetryPerformance() {
    const summary = buildTelemetryPerformanceSummary(telemetryState.events, {
        slowThresholdMs: 1500,
        groupLimit: 8,
        slowLimit: 8
    });

    if (!summary.count) {
        renderTelemetryPerformanceEmpty();
        return;
    }

    setTelemetryText('telemetry-performance-samples', telemetryNumber(summary.count));
    setTelemetryText('telemetry-performance-p50', formatPerformanceDuration(summary.p50Ms));
    setTelemetryText('telemetry-performance-p95', formatPerformanceDuration(summary.p95Ms));
    setTelemetryText(
        'telemetry-performance-slow',
        `${telemetryNumber(summary.slowCount)} >= ${formatPerformanceDuration(summary.slowThresholdMs)}`
    );

    renderTelemetryList('telemetry-performance-groups', summary.groups, (group) => `
        <div class="border-b border-gray-100 pb-2 last:border-0">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="text-sm font-medium text-gray-900 truncate">${escapeHtml(group.label)}</p>
                    <p class="text-xs text-gray-500 truncate">${escapeHtml(group.route || '-')}</p>
                </div>
                <span class="text-xs font-semibold text-gray-900 whitespace-nowrap">P95 ${escapeHtml(formatPerformanceDuration(group.p95Ms))}</span>
            </div>
            <p class="text-xs text-gray-500 mt-1">${telemetryNumber(group.count)} samples · ${telemetryNumber(group.slowCount)} slow · max ${escapeHtml(formatPerformanceDuration(group.maxMs))}</p>
        </div>
    `, 'No app performance telemetry has been recorded for this range.');

    renderTelemetryList('telemetry-performance-slow-events', summary.slowEvents, (item) => {
        const createdAt = item.createdAt;
        const owner = item.userId ? `User ${item.userId}` : `Session ${item.sessionId || '-'}`;
        return `
            <div class="border-b border-gray-100 pb-2 last:border-0">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="text-sm font-medium text-gray-900 truncate">${escapeHtml(item.label)}</p>
                        <p class="text-xs text-gray-500 truncate">${escapeHtml(item.route || '-')}</p>
                    </div>
                    <span class="text-xs font-semibold text-gray-900 whitespace-nowrap">${escapeHtml(formatPerformanceDuration(item.durationMs))}</span>
                </div>
                <p class="text-xs text-gray-500 mt-1">${escapeHtml(owner)}${createdAt ? ` · ${escapeHtml(createdAt.toLocaleString())}` : ''}</p>
            </div>
        `;
    }, 'No slow app performance examples have been recorded for this range.');

    const trackedRows = buildTrackedWorkflowLoadSummary(telemetryState.events, {
        slowThresholdMs: summary.slowThresholdMs
    });
    renderTelemetryList('telemetry-performance-tracked-workflows', trackedRows, (row) => {
        const latest = telemetryDate(row.latestAt);
        return `
            <div class="border-b border-gray-100 pb-2 last:border-0">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="text-sm font-medium text-gray-900 truncate">${escapeHtml(row.label)}</p>
                        <p class="text-xs text-gray-500 truncate">${row.route ? escapeHtml(row.route) : 'Waiting for samples'}</p>
                    </div>
                    <span class="text-xs font-semibold text-gray-900 whitespace-nowrap">P95 ${escapeHtml(row.count ? formatPerformanceDuration(row.p95Ms) : '-')}</span>
                </div>
                <p class="text-xs text-gray-500 mt-1">${telemetryNumber(row.count)} samples · P50 ${escapeHtml(row.count ? formatPerformanceDuration(row.p50Ms) : '-')} · max ${escapeHtml(row.count ? formatPerformanceDuration(row.maxMs) : '-')}${latest ? ` · latest ${escapeHtml(latest.toLocaleString())}` : ''}</p>
            </div>
        `;
    }, 'No tracked workflow timers have been recorded for this range.');
}

function renderRecentTelemetrySessions() {
    const cutoff = Date.now() - telemetryState.days * 24 * 60 * 60 * 1000;
    const sessions = telemetryState.sessions
        .filter((session) => {
            const updatedAt = telemetryDate(session.updatedAt);
            return !updatedAt || updatedAt.getTime() >= cutoff;
        })
        .slice(0, 25);

    renderTelemetryList('telemetry-recent-sessions', sessions, (session) => {
        const updatedAt = telemetryDate(session.updatedAt);
        return `
            <div class="border-b border-gray-100 pb-3 last:border-0">
                <div class="flex items-center justify-between gap-3">
                    <p class="font-medium text-gray-900 truncate">${escapeHtml(session.lastRoute || session.entryRoute || session.lastPage || session.entryPage || '-')}</p>
                    <span class="text-xs text-gray-500 whitespace-nowrap">${updatedAt ? updatedAt.toLocaleString() : '-'}</span>
                </div>
                <p class="text-xs text-gray-500 mt-1">${telemetryNumber(session.eventCount)} events · ${telemetryNumber(session.pageViews)} views · ${telemetryNumber(session.interactions)} interactions</p>
                <p class="text-xs text-gray-400 mt-1 truncate">${escapeHtml(session.userId ? `User ${session.userId}` : `Visitor ${session.visitorId || '-'}`)}</p>
            </div>
        `;
    }, 'No recent sessions have been recorded for this range.');
}

function renderTelemetryEventsTable() {
    const tbody = document.getElementById('telemetry-events-table');
    if (!tbody) return;

    const events = getFilteredTelemetryEvents().slice(0, 150);
    if (!events.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="px-6 py-4 text-sm text-gray-400">No events match the current filters.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = events.map((event) => {
        const createdAt = telemetryDate(event.createdAt) || telemetryDate(event.clientTimestamp);
        const route = getTelemetryRoute(event);
        return `
            <tr>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${createdAt ? createdAt.toLocaleString() : '-'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${escapeHtml(event.name || '-')}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${escapeHtml(route)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${escapeHtml(getTelemetryTarget(event))}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${event.userId ? 'Signed in' : 'Anonymous'}</td>
            </tr>
        `;
    }).join('');
}

function updateTelemetryDashboard() {
    if (!telemetryState.loaded) {
        const errorMessage = telemetryState.error
            ? `Telemetry could not be loaded: ${telemetryState.error}`
            : 'No telemetry has been loaded yet.';

        renderMetric('telemetry-total-events', 0);
        renderMetric('telemetry-page-views', 0);
        renderMetric('telemetry-interactions', 0);
        renderMetric('telemetry-sessions', 0);
        renderMetric('telemetry-known-users', 0);
        renderMetric('telemetry-errors', 0);
        renderEmptyTelemetry('telemetry-daily-trend', errorMessage);
        renderEmptyTelemetry('telemetry-needs-attention', errorMessage);
        renderEmptyTelemetry('telemetry-top-pages', errorMessage);
        renderEmptyTelemetry('telemetry-top-routes', errorMessage);
        renderEmptyTelemetry('telemetry-top-events', errorMessage);
        renderEmptyTelemetry('telemetry-recent-sessions', errorMessage);
        renderTelemetryPerformanceEmpty(errorMessage);

        const tbody = document.getElementById('telemetry-events-table');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="px-6 py-4 text-sm text-gray-400">${escapeHtml(errorMessage)}</td>
                </tr>
            `;
        }
        return;
    }

    const knownUsers = new Set(telemetryState.events.map((event) => event.userId).filter(Boolean));

    renderMetric('telemetry-total-events', sumBy(telemetryState.daily, 'totalEvents'));
    renderMetric('telemetry-page-views', sumBy(telemetryState.daily, 'pageViews'));
    renderMetric('telemetry-interactions', sumBy(telemetryState.daily, 'interactions'));
    renderMetric('telemetry-sessions', telemetryState.sessions.length);
    renderMetric('telemetry-known-users', knownUsers.size);
    renderMetric('telemetry-errors', sumBy(telemetryState.daily, 'errors'));

    renderTelemetryNeedsAttention();
    renderTelemetryPerformance();
    renderTelemetryTrend();
    renderTopTelemetryPages();
    renderTopTelemetryRoutes();
    renderTopTelemetryEvents();
    renderRecentTelemetrySessions();
    renderTelemetryEventsTable();
}

function getOfficialsCellClasses(tone) {
    if (tone === 'missing') return 'bg-rose-100 text-rose-700';
    if (tone === 'warning') return 'bg-amber-100 text-amber-700';
    return 'bg-emerald-100 text-emerald-700';
}

function getDeferredOfficialsSummary() {
    return {
        badgeTone: 'warning',
        badgeLabel: 'Loads on demand',
        detailTone: 'default',
        detailLabel: 'Open this team page or users tab to fetch officials.'
    };
}

function renderTeams(teams) {
    const tbody = document.getElementById('teams-table-body');
    const officialsReady = loadedTeamsOfficialsPageKey === getCurrentTeamPageKey();
    tbody.innerHTML = teams.map(team => {
        const officialsSummary = officialsReady
            ? buildAdminTeamOfficialsSummary(team, officialsByTeamId.get(team.id) || [], allGames)
            : getDeferredOfficialsSummary();
        const manageOfficialsHref = `edit-schedule.html?teamId=${encodeURIComponent(team.id)}#officials`;
        return `
        <tr>
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex items-center">
                    <div class="flex-shrink-0 h-10 w-10">
                        ${team.photoUrl
            ? `<img class="h-10 w-10 rounded-full object-cover" src="${escapeHtml(team.photoUrl)}" alt="">`
            : `<div class="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold">${escapeHtml(team.name.charAt(0))}</div>`
        }
                    </div>
                    <div class="ml-4">
                        <div class="text-sm font-medium text-gray-900">${escapeHtml(team.name)}</div>
                        <div class="text-sm text-gray-500">${escapeHtml(team.description || '').substring(0, 30)}...</div>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${escapeHtml(getTeamOwnerEmail(team))}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex flex-col gap-1">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 w-fit">
                        ${escapeHtml(team.sport || 'Unknown')}
                    </span>
                    ${team.active === false ? '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800 w-fit">Inactive</span>' : ''}
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${escapeHtml(team.zip || '-')}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${team.createdAt?.toDate ? team.createdAt.toDate().toLocaleDateString() : '-'}
            </td>
            <td class="px-6 py-4 text-sm text-gray-600">
                <div class="flex flex-col gap-1 min-w-[13rem]">
                    <span class="inline-flex w-fit items-center rounded-full px-2 py-1 text-xs font-semibold ${getOfficialsCellClasses(officialsSummary.badgeTone)}">${escapeHtml(officialsSummary.badgeLabel)}</span>
                    <span class="text-xs ${officialsSummary.detailTone === 'warning' ? 'text-amber-700 font-medium' : 'text-gray-500'}">${escapeHtml(officialsSummary.detailLabel)}</span>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <a href="${manageOfficialsHref}" class="text-indigo-600 hover:text-indigo-900 mr-4">Manage Officials</a>
                <button onclick="window.openRegistrationFormsAdmin(${inlineJsString(team.id)})" class="text-indigo-600 hover:text-indigo-900 mr-4">Registration forms</button>
                <button onclick="window.openOfficialsAdmin(${inlineJsString(team.id)})" class="text-indigo-600 hover:text-indigo-900 mr-4">Officials</button>
                <a href="edit-team.html?teamId=${encodeURIComponent(team.id)}" class="text-indigo-600 hover:text-indigo-900 mr-4">Edit</a>
                ${canCurrentUserDeactivateTeam(team)
        ? `<button onclick="window.deleteTeamAdmin(${inlineJsString(team.id)}, ${inlineJsString(team.name)})" class="text-red-600 hover:text-red-900">Deactivate</button>`
        : '<span class="text-xs font-medium text-gray-400">Owner only</span>'}
            </td>
        </tr>
    `;
    }).join('');
}

function resetOfficialsAdminFormState() {
    document.getElementById('officials-admin-id').value = '';
    document.getElementById('officials-admin-form').reset();
    document.getElementById('officials-admin-save-btn').textContent = 'Save official';
    document.getElementById('officials-admin-cancel-btn').classList.add('hidden');
    document.getElementById('officials-admin-message').textContent = '';
}

function renderOfficialsAdminList() {
    const list = document.getElementById('officials-admin-list');
    if (!activeOfficials.length) {
        list.innerHTML = '<p class="text-sm text-gray-500">No officials saved for this team yet.</p>';
        return;
    }

    list.innerHTML = activeOfficials.map((official) => {
        const roles = Array.isArray(official.roles) ? official.roles : [];
        const tags = Array.isArray(official.tags) ? official.tags : [];
        const contact = [official.email, official.phone].filter(Boolean).join(' • ');
        return `
            <div class="rounded border border-gray-200 p-3">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <p class="font-semibold text-gray-900">${escapeHtml(official.name || 'Official')}</p>
                        <p class="text-sm text-gray-600">${escapeHtml(contact || 'No contact saved')}</p>
                    </div>
                    <div class="flex gap-2 text-sm">
                        <button type="button" class="font-medium text-indigo-600 hover:text-indigo-800" data-edit-official-id="${escapeHtml(official.id)}">Edit</button>
                        <button type="button" class="font-medium text-red-600 hover:text-red-800" data-delete-official-id="${escapeHtml(official.id)}">Remove</button>
                    </div>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                    ${roles.length
                        ? roles.map((role) => `<span class="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">${escapeHtml(role)}</span>`).join('')
                        : '<span class="text-xs text-gray-400">No roles saved</span>'}
                </div>
                ${tags.length ? `<div class="mt-2 flex flex-wrap gap-1">${tags.map((tag) => `<span class="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
            </div>
        `;
    }).join('');
}

async function loadOfficialsForActiveTeam() {
    const teamId = activeOfficialsTeam?.id;
    const list = document.getElementById('officials-admin-list');
    if (!teamId || !list) return;

    list.innerHTML = '<p class="text-sm text-gray-500">Loading officials...</p>';
    try {
        const officials = await getOfficials(teamId);
        if (activeOfficialsTeam?.id !== teamId) return;

        activeOfficials = officials;
        renderOfficialsAdminList();
    } catch (error) {
        console.error('Error loading officials for admin modal:', error);
        if (activeOfficialsTeam?.id !== teamId) return;

        activeOfficials = [];
        list.innerHTML = '<p class="text-sm text-red-600">Failed to load officials. Please try again.</p>';
    }
}

function getOfficialsAdminDraft() {
    return {
        name: document.getElementById('officials-admin-name').value.trim(),
        email: document.getElementById('officials-admin-email').value.trim(),
        phone: document.getElementById('officials-admin-phone').value.trim(),
        roles: splitDirectoryInput(document.getElementById('officials-admin-roles').value),
        tags: splitDirectoryInput(document.getElementById('officials-admin-tags').value)
    };
}

window.openOfficialsAdmin = async function (teamId) {
    activeOfficialsTeam = getAdminTeamById(teamId);
    if (!activeOfficialsTeam) return;

    document.getElementById('officials-admin-team-name').textContent = activeOfficialsTeam.name || 'Team';
    document.getElementById('officials-admin-modal').classList.remove('hidden');
    window.startOfficialsAdminEdit();
    await loadOfficialsForActiveTeam();
};

window.closeOfficialsAdmin = function () {
    document.getElementById('officials-admin-modal').classList.add('hidden');
};

window.resetOfficialsAdminForm = function () {
    resetOfficialsAdminFormState();
};

window.startOfficialsAdminEdit = function (officialId = '') {
    const official = activeOfficials.find((item) => item.id === officialId) || {};
    const form = document.getElementById('officials-admin-form');
    document.getElementById('officials-admin-id').value = official.id || '';
    document.getElementById('officials-admin-name').value = official.name || '';
    document.getElementById('officials-admin-email').value = official.email || '';
    document.getElementById('officials-admin-phone').value = official.phone || '';
    document.getElementById('officials-admin-roles').value = Array.isArray(official.roles) ? official.roles.join(', ') : '';
    document.getElementById('officials-admin-tags').value = Array.isArray(official.tags) ? official.tags.join(', ') : '';
    document.getElementById('officials-admin-save-btn').textContent = official.id ? 'Update official' : 'Save official';
    document.getElementById('officials-admin-cancel-btn').classList.toggle('hidden', !official.id);
    document.getElementById('officials-admin-message').textContent = '';
    form.classList.remove('hidden');
};

async function saveOfficialsAdmin(event) {
    event.preventDefault();
    if (!activeOfficialsTeam) return;

    const teamId = activeOfficialsTeam.id;
    const officialId = document.getElementById('officials-admin-id').value;
    const message = document.getElementById('officials-admin-message');
    const draft = getOfficialsAdminDraft();

    try {
        if (officialId) {
            await updateOfficial(teamId, officialId, draft);
        } else {
            await addOfficial(teamId, draft);
        }
    } catch (error) {
        console.error('Error saving team official:', error);
        message.textContent = error.message || 'Failed to save official.';
        return;
    }

    message.textContent = officialId ? 'Official updated.' : 'Official saved.';
    loadedTeamsOfficialsPageKey = '';
    loadedUsersOfficialsKey = '';
    resetOfficialsAdminFormState();
    document.getElementById('officials-admin-form').classList.remove('hidden');
    await loadOfficialsForActiveTeam();
}

async function handleOfficialsAdminListClick(event) {
    const editId = event.target.dataset.editOfficialId;
    const deleteId = event.target.dataset.deleteOfficialId;

    if (editId) {
        window.startOfficialsAdminEdit(editId);
        return;
    }
    if (!deleteId || !activeOfficialsTeam) return;

    const official = activeOfficials.find((item) => item.id === deleteId);
    if (!confirm(`Remove ${official?.name || 'this official'} from ${activeOfficialsTeam.name || 'this team'}?`)) return;

    const message = document.getElementById('officials-admin-message');
    try {
        await deleteOfficial(activeOfficialsTeam.id, deleteId);
        if (document.getElementById('officials-admin-id').value === deleteId) {
            resetOfficialsAdminFormState();
            document.getElementById('officials-admin-form').classList.remove('hidden');
        }
        loadedTeamsOfficialsPageKey = '';
        loadedUsersOfficialsKey = '';
        message.textContent = 'Official removed.';
        await loadOfficialsForActiveTeam();
    } catch (error) {
        console.error('Error removing team official:', error);
        message.textContent = error.message || 'Failed to remove official.';
    }
}

function renderUsers(users) {
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = users.map(u => {
        const officialSummary = getOfficialUserSummary(u, officialUserLookup);
        const officialSummaryText = formatOfficialUserSummary(officialSummary);
        // Determine verification status:
        // - emailVerificationRequired=true + not verified → unverified (red)
        // - emailVerificationRequired not set → signed up via Google/OAuth (inherently verified)
        // - verified → green check
        const needsVerification = u.emailVerificationRequired === true;
        const isVerified = !needsVerification || u.emailVerified;
        const verifiedHtml = isVerified
            ? '<span class="inline-flex items-center gap-1 text-green-600"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg></span>'
            : '<span class="inline-flex items-center gap-1 text-red-400"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path></svg></span>';

        return `
        <tr>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                <div class="flex items-center gap-2">
                    <span>${escapeHtml(u.email || '-')}</span>
                    ${officialSummary ? '<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Official</span>' : ''}
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${escapeHtml(u.fullName || '-')}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${escapeHtml(u.phone || '-')}
            </td>
            <td class="px-6 py-4 text-sm text-gray-500">
                ${officialSummary
                ? `<div class="text-sm text-gray-700">${escapeHtml(officialSummaryText)}</div>`
                : '<span class="text-gray-400">-</span>'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${u.updatedAt?.toDate ? u.updatedAt.toDate().toLocaleDateString() : '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">
                ${verifiedHtml}
            </td>
        </tr>
    `;
    }).join('');
}

window.deleteTeamAdmin = async function (teamId, teamName) {
    const team = getAdminTeamById(teamId);
    if (!canCurrentUserDeactivateTeam(team)) {
        alert('Team deactivation is only available to the team owner in the dashboard workflow.');
        return;
    }

    if (confirm(`ADMIN ACTION: Deactivate team "${teamName}"? Team data will be retained.`)) {
        try {
            await deleteTeam(teamId);
            alert('Team deactivated.');
            await loadData(); // Reload
        } catch (e) {
            console.error(e);
            alert('Error deactivating team: ' + e.message);
        }
    }
};

window.openRegistrationFormsAdmin = async function (teamId) {
    activeRegistrationTeam = getAdminTeamById(teamId);
    if (!activeRegistrationTeam) return;

    document.getElementById('registration-team-name').textContent = activeRegistrationTeam.name || 'Team';
    document.getElementById('registration-form-editor').classList.add('hidden');
    document.getElementById('registration-forms-modal').classList.remove('hidden');
    await loadRegistrationFormsForActiveTeam();
};

window.closeRegistrationFormsAdmin = function () {
    document.getElementById('registration-forms-modal').classList.add('hidden');
};

function hasAdvancedRegistrationSettings(form = {}) {
    const participantFields = formatFieldLabels(form.participantFields, adminRegistrationDefaults.participantLabels);
    const guardianFields = formatFieldLabels(form.guardianFields, adminRegistrationDefaults.guardianLabels);
    const defaultParticipantFields = adminRegistrationDefaults.participantLabels.join('\n');
    const defaultGuardianFields = adminRegistrationDefaults.guardianLabels.join('\n');
    return Boolean(
        form.description
        || participantFields !== defaultParticipantFields
        || guardianFields !== defaultGuardianFields
        || form.paymentSettings?.offlinePaymentEnabled
        || form.paymentSettings?.onlineCheckoutEnabled
        || form.installmentPlan?.enabled
        || form.registrationOptions?.length
        || form.discountRules?.length
        || form.backgroundCheck?.required
        || form.backgroundCheck?.enabled
        || form.backgroundCheck?.instructions
        || form.backgroundCheck?.providerName
    );
}

window.startRegistrationFormAdmin = function (formId = '') {
    const form = activeRegistrationForms.find(item => item.id === formId) || {};
    const editor = document.getElementById('registration-form-editor');
    document.getElementById('registration-form-id').value = form.id || '';
    document.getElementById('registration-title').value = form.programName || form.title || '';
    document.getElementById('registration-description').value = form.description || '';
    document.getElementById('registration-program-type').value = form.programType || 'season';
    document.getElementById('registration-season').value = form.season || '';
    document.getElementById('registration-fee').value = Number(form.feeAmountCents || 0) / 100;
    const installmentPlan = form.installmentPlan || {};
    document.getElementById('registration-installments-enabled').checked = installmentPlan.enabled === true;
    document.getElementById('registration-installment-count').value = installmentPlan.installmentCount || '';
    document.getElementById('registration-installment-first-date').value = installmentPlan.firstDueDate || '';
    document.getElementById('registration-installment-interval').value = installmentPlan.intervalDays || '';
    document.getElementById('registration-participant-fields').value = formatFieldLabels(form.participantFields, adminRegistrationDefaults.participantLabels);
    document.getElementById('registration-guardian-fields').value = formatFieldLabels(form.guardianFields, adminRegistrationDefaults.guardianLabels);
    document.getElementById('registration-offline-payment').checked = form.paymentSettings?.offlinePaymentEnabled === true;
    document.getElementById('registration-online-checkout').checked = form.paymentSettings?.onlineCheckoutEnabled === true;
    document.getElementById('registration-discount-rules').value = formatRegistrationDiscountRulesText(form.discountRules);
    document.getElementById('registration-background-check-required').checked = form.backgroundCheck?.required === true;
    document.getElementById('registration-background-check-instructions').value = form.backgroundCheck?.instructions || '';
    document.getElementById('registration-background-check-enabled').checked = form.backgroundCheck?.enabled === true;
    document.getElementById('registration-screening-initial-status').value = form.backgroundCheck?.initialScreeningStatus || 'pending';
    document.getElementById('registration-screening-provider').value = form.backgroundCheck?.providerName || '';
    activeRegistrationOptions = Array.isArray(form.registrationOptions) ? form.registrationOptions.map(option => ({ ...option })) : [];
    renderRegistrationOptionsEditor();
    document.getElementById('registration-waiver').value = form.waiverText || '';
    document.getElementById('registration-status').value = getRegistrationAdminStatus(form);
    document.getElementById('registration-form-message').textContent = '';
    document.getElementById('registration-advanced-settings').open = Boolean(form.id && hasAdvancedRegistrationSettings(form));
    editor.classList.remove('hidden');
};

window.addRegistrationOptionAdmin = function () {
    syncActiveRegistrationOptionsFromEditor();
    activeRegistrationOptions.push({
        id: `option_${Date.now()}`,
        label: '',
        capacityLimit: null,
        active: true,
        waitlistEnabled: false
    });
    renderRegistrationOptionsEditor();
};

window.removeRegistrationOptionAdmin = function (index) {
    syncActiveRegistrationOptionsFromEditor();
    activeRegistrationOptions.splice(index, 1);
    renderRegistrationOptionsEditor();
};

window.moveRegistrationOptionAdmin = function (index, direction) {
    syncActiveRegistrationOptionsFromEditor();
    const target = index + direction;
    if (target < 0 || target >= activeRegistrationOptions.length) return;
    const [option] = activeRegistrationOptions.splice(index, 1);
    activeRegistrationOptions.splice(target, 0, option);
    renderRegistrationOptionsEditor();
};

function renderRegistrationOptionsEditor() {
    const list = document.getElementById('registration-options-list');
    if (!list) return;
    if (!activeRegistrationOptions.length) {
        list.innerHTML = '<p class="text-sm text-gray-500">No options configured. Add options only when this form needs capacity or waitlist setup.</p>';
        return;
    }

    list.innerHTML = activeRegistrationOptions.map((option, index) => `
        <div class="registration-option-row rounded border border-gray-200 bg-gray-50 p-3" data-option-id="${escapeHtml(option.id || '')}">
            <div class="grid gap-3 md:grid-cols-2">
                <label class="text-sm font-medium text-gray-700">Label
                    <input class="registration-option-label mt-1 w-full rounded border border-gray-300 p-2" value="${escapeHtml(option.label || '')}" placeholder="Early bird" aria-label="Registration option label">
                </label>
                <label class="text-sm font-medium text-gray-700">Capacity limit
                    <input class="registration-option-capacity mt-1 w-full rounded border border-gray-300 p-2" type="number" min="0" step="1" value="${option.capacityLimit === null || option.capacityLimit === undefined || option.capacityLimit === '' ? '' : Number(option.capacityLimit)}" placeholder="Optional" aria-label="Registration option capacity limit">
                </label>
            </div>
            <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div class="flex flex-wrap gap-4 text-sm text-gray-700">
                    <label class="inline-flex items-center gap-2"><input class="registration-option-active rounded border-gray-300" type="checkbox" ${option.active === false ? '' : 'checked'}> Active</label>
                    <label class="inline-flex items-center gap-2"><input class="registration-option-waitlist rounded border-gray-300" type="checkbox" ${option.waitlistEnabled === true ? 'checked' : ''}> Waitlist when full</label>
                </div>
                <div class="flex gap-2 text-sm">
                    <button type="button" onclick="window.moveRegistrationOptionAdmin(${index}, -1)" class="rounded px-2 py-1 text-gray-600 hover:bg-gray-200" ${index === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" onclick="window.moveRegistrationOptionAdmin(${index}, 1)" class="rounded px-2 py-1 text-gray-600 hover:bg-gray-200" ${index === activeRegistrationOptions.length - 1 ? 'disabled' : ''}>↓</button>
                    <button type="button" onclick="window.removeRegistrationOptionAdmin(${index})" class="rounded px-2 py-1 text-red-600 hover:bg-red-50">Remove</button>
                </div>
            </div>
        </div>
    `).join('');
}

function collectRegistrationOptionsFromEditor() {
    const rows = Array.from(document.querySelectorAll('#registration-options-list .registration-option-row'));
    return rows.map((row) => ({
        id: row.dataset.optionId,
        label: row.querySelector('.registration-option-label')?.value || '',
        capacityLimit: row.querySelector('.registration-option-capacity')?.value || '',
        active: row.querySelector('.registration-option-active')?.checked === true,
        waitlistEnabled: row.querySelector('.registration-option-waitlist')?.checked === true
    }));
}

function syncActiveRegistrationOptionsFromEditor() {
    activeRegistrationOptions = collectRegistrationOptionsFromEditor();
}

window.copyRegistrationLinkAdmin = async function (teamId, formId) {
    const url = getAdminRegistrationShareUrl(teamId, formId, window.location.origin);
    const message = document.getElementById('registration-form-message');
    try {
        await navigator.clipboard.writeText(url);
        message.textContent = 'Registration link copied.';
    } catch (error) {
        console.error('Failed to copy registration link:', error);
        message.textContent = `Unable to copy automatically. Use this link: ${url}`;
    }
};

async function loadRegistrationFormsForActiveTeam() {
    const team = activeRegistrationTeam;
    const teamId = team?.id;
    if (!teamId) return;

    const list = document.getElementById('registration-forms-list');
    list.innerHTML = '<p class="text-sm text-gray-500">Loading registration forms...</p>';
    try {
        const snapshot = await getDocs(collection(db, `teams/${teamId}/registrationForms`));
        if (activeRegistrationTeam?.id !== teamId) return;

        activeRegistrationForms = snapshot.docs
            .map(formDoc => ({ id: formDoc.id, ...formDoc.data() }))
            .sort((a, b) => String(a.programName || a.title || '').localeCompare(String(b.programName || b.title || '')));
        renderRegistrationFormsList();
    } catch (error) {
        console.error('Error loading registration forms:', error);
        if (activeRegistrationTeam?.id === teamId) {
            list.innerHTML = '<p class="text-sm text-red-600">Failed to load registration forms. Please try again.</p>';
        }
    }
}

function renderRegistrationFormsList() {
    const list = document.getElementById('registration-forms-list');
    if (!activeRegistrationForms.length) {
        list.innerHTML = '<p class="text-sm text-gray-500">No registration forms yet.</p>';
        return;
    }

    list.innerHTML = activeRegistrationForms.map(form => {
        const status = getRegistrationAdminStatus(form);
        const published = status === 'published';
        const closed = status === 'closed';
        const statusLabel = status === 'closed' ? 'Closed' : published ? 'Published' : 'Draft';
        const link = getAdminRegistrationShareUrl(activeRegistrationTeam.id, form.id, window.location.origin);
        const teamIdArg = inlineJsString(activeRegistrationTeam.id);
        const formIdArg = inlineJsString(form.id);
        return `
            <div class="rounded border border-gray-200 p-3">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <p class="font-semibold text-gray-900">${escapeHtml(form.programName || form.title || 'Untitled form')}</p>
                        <p class="text-xs text-gray-500">${escapeHtml(form.programType || 'season')} • ${statusLabel}</p>
                    </div>
                    <button onclick="window.startRegistrationFormAdmin(${formIdArg})" class="text-sm text-indigo-600 hover:text-indigo-800">Edit</button>
                </div>
                ${published ? `<div class="mt-2 rounded bg-green-50 p-2 text-xs text-green-800 break-all">${escapeHtml(link)} <button onclick="window.copyRegistrationLinkAdmin(${teamIdArg}, ${formIdArg})" class="ml-2 font-semibold underline">Copy</button></div>` : closed ? '<p class="mt-2 text-xs text-amber-700">Closed forms keep review history but do not accept new registrations.</p>' : '<p class="mt-2 text-xs text-gray-500">Publish to generate a parent-facing registration link.</p>'}
            </div>
        `;
    }).join('');
}

function getRegistrationAdminStatus(form = {}) {
    const status = String(form.status || '').trim().toLowerCase();
    if (status === 'closed') return 'closed';
    if (status === 'published' || status === 'open' || form.published === true) return 'published';
    return 'draft';
}

async function saveRegistrationForm(event) {
    event.preventDefault();
    if (!activeRegistrationTeam) return;

    const teamId = activeRegistrationTeam.id;
    const formId = document.getElementById('registration-form-id').value;
    const payload = buildAdminRegistrationFormPayload({
        title: document.getElementById('registration-title').value,
        description: document.getElementById('registration-description').value,
        programType: document.getElementById('registration-program-type').value,
        season: document.getElementById('registration-season').value,
        feeAmount: document.getElementById('registration-fee').value,
        participantFieldsText: document.getElementById('registration-participant-fields').value,
        guardianFieldsText: document.getElementById('registration-guardian-fields').value,
        registrationOptions: collectRegistrationOptionsFromEditor(),
        paymentSettings: {
            offlinePaymentEnabled: document.getElementById('registration-offline-payment').checked,
            onlineCheckoutEnabled: document.getElementById('registration-online-checkout').checked
        },
        installmentPlan: {
            enabled: document.getElementById('registration-installments-enabled').checked,
            installmentCount: document.getElementById('registration-installment-count').value,
            firstDueDate: document.getElementById('registration-installment-first-date').value,
            intervalDays: document.getElementById('registration-installment-interval').value
        },
        discountRules: parseRegistrationDiscountRulesText(document.getElementById('registration-discount-rules').value),
        backgroundCheck: {
            required: document.getElementById('registration-background-check-required').checked,
            instructions: document.getElementById('registration-background-check-instructions').value,
            enabled: document.getElementById('registration-background-check-enabled').checked,
            initialScreeningStatus: document.getElementById('registration-screening-initial-status').value,
            providerName: document.getElementById('registration-screening-provider').value
        },
        waiverText: document.getElementById('registration-waiver').value,
        status: document.getElementById('registration-status').value
    }, { teamId });
    const errors = validateAdminRegistrationFormPayload(payload);
    const message = document.getElementById('registration-form-message');
    if (errors.length) {
        message.textContent = errors.join(' ');
        return;
    }

    try {
        if (formId) {
            await updateDoc(doc(db, `teams/${teamId}/registrationForms`, formId), {
                ...payload,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser.uid
            });
        } else {
            const formRef = doc(collection(db, `teams/${teamId}/registrationForms`));
            await setDoc(formRef, {
                ...payload,
                createdAt: serverTimestamp(),
                createdBy: currentUser.uid,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser.uid
            });
        }
    } catch (error) {
        console.error('Error saving registration form:', error);
        message.textContent = 'Failed to save registration form. Please try again.';
        return;
    }

    message.textContent = payload.status === 'closed'
        ? 'Registration form saved and closed.'
        : payload.published ? 'Registration form saved and published.' : 'Registration form saved as draft.';
    if (activeRegistrationTeam?.id === teamId) {
        await loadRegistrationFormsForActiveTeam();
        document.getElementById('registration-form-editor').classList.add('hidden');
    }
}

async function renderCurrentTeamsView() {
    const term = normalizeAdminSearchTerm(document.getElementById('search-teams')?.value || '');
    const teams = await getAdminTeamsForSearch(term);
    const latestTerm = normalizeAdminSearchTerm(document.getElementById('search-teams')?.value || '');
    if (term !== latestTerm) return;

    const visibleTeams = showInactiveTeams ? teams : teams.filter(isTeamActive);
    const filtered = visibleTeams.filter((team) =>
        !term
        || (team.name || '').toLowerCase().includes(term)
        || (team.sport || '').toLowerCase().includes(term)
    );
    renderTeams(filtered);
}

async function renderCurrentUsersView() {
    const term = normalizeAdminSearchTerm(document.getElementById('search-users')?.value || '');
    const officialFilter = document.getElementById('filter-users-official-status')?.value || 'all';
    const users = await getAdminUsersForSearch(term);
    const latestTerm = normalizeAdminSearchTerm(document.getElementById('search-users')?.value || '');
    if (term !== latestTerm) return;

    await loadVisibleOfficialUserLinks(users);
    const refreshedTerm = normalizeAdminSearchTerm(document.getElementById('search-users')?.value || '');
    if (term !== refreshedTerm) return;

    const filtered = users.filter((u) => {
        const officialSummary = getOfficialUserSummary(u, officialUserLookup);
        if (officialFilter === 'officials' && !officialSummary) return false;
        if (officialFilter === 'non-officials' && officialSummary) return false;
        return matchesOfficialUserSearch(u, officialSummary, term);
    });
    renderUsers(filtered);
}

async function loadNextTeamsPage() {
    if (teamPageState.loading) return;
    teamPageState.loading = true;
    updateTeamsPaginationControls();
    try {
        if (teamPageState.currentIndex < teamPageState.pages.length - 1) {
            loadedGamesPageKey = '';
            loadedTeamsOfficialsPageKey = '';
            setTeamsPage(teamPageState.pages[teamPageState.currentIndex + 1] || [], teamPageState.nextCursor, teamPageState.currentIndex + 1);
        } else if (teamPageState.nextCursor) {
            const nextIndex = teamPageState.currentIndex + 1;
            const page = await loadAdminCollectionPage({
                fetchPage: getAdminTeamsPage,
                cursor: teamPageState.nextCursor,
                pageSize: teamPageState.pageSize
            });
            loadedGamesPageKey = '';
            loadedTeamsOfficialsPageKey = '';
            setTeamsPage(page.teams, page.nextCursor, nextIndex);
        } else {
            return;
        }
        if (activeTab === 'dashboard') {
            await ensureCurrentTeamGamesLoaded();
            updateDashboard();
        }
        if (activeTab === 'teams') {
            await ensureCurrentTeamOfficialsLoaded();
        }
        if (activeTab === 'users') {
            await ensureCurrentUsersOfficialsLoaded();
            renderCurrentUsersView();
        }
        renderCurrentTeamsView();
    } finally {
        teamPageState.loading = false;
        updateTeamsPaginationControls();
    }
}

async function loadPreviousTeamsPage() {
    if (teamPageState.loading || teamPageState.currentIndex === 0) return;
    teamPageState.loading = true;
    updateTeamsPaginationControls();
    try {
        loadedGamesPageKey = '';
        loadedTeamsOfficialsPageKey = '';
        const previousIndex = teamPageState.currentIndex - 1;
        setTeamsPage(teamPageState.pages[previousIndex] || [], teamPageState.nextCursor, previousIndex);
        if (activeTab === 'dashboard') {
            await ensureCurrentTeamGamesLoaded();
            updateDashboard();
        }
        if (activeTab === 'teams') {
            await ensureCurrentTeamOfficialsLoaded();
        }
        if (activeTab === 'users') {
            await ensureCurrentUsersOfficialsLoaded();
            renderCurrentUsersView();
        }
        renderCurrentTeamsView();
    } finally {
        teamPageState.loading = false;
        updateTeamsPaginationControls();
    }
}

async function loadNextUsersPage() {
    if (userPageState.loading) return;
    userPageState.loading = true;
    updateUsersPaginationControls();
    try {
        if (userPageState.currentIndex < userPageState.pages.length - 1) {
            setUsersPage(userPageState.pages[userPageState.currentIndex + 1] || [], userPageState.nextCursor, userPageState.currentIndex + 1);
        } else if (userPageState.nextCursor) {
            const nextIndex = userPageState.currentIndex + 1;
            const page = await loadAdminCollectionPage({
                fetchPage: getAdminUsersPage,
                cursor: userPageState.nextCursor,
                pageSize: userPageState.pageSize
            });
            setUsersPage(page.users, page.nextCursor, nextIndex);
        } else {
            return;
        }
        await ensureCurrentUsersOfficialsLoaded();
        renderCurrentUsersView();
        if (activeTab === 'dashboard') {
            updateDashboard();
        }
    } finally {
        userPageState.loading = false;
        updateUsersPaginationControls();
    }
}

async function loadPreviousUsersPage() {
    if (userPageState.loading || userPageState.currentIndex === 0) return;
    userPageState.loading = true;
    updateUsersPaginationControls();
    try {
        const previousIndex = userPageState.currentIndex - 1;
        setUsersPage(userPageState.pages[previousIndex] || [], userPageState.nextCursor, previousIndex);
        await ensureCurrentUsersOfficialsLoaded();
        renderCurrentUsersView();
        if (activeTab === 'dashboard') {
            updateDashboard();
        }
    } finally {
        userPageState.loading = false;
        updateUsersPaginationControls();
    }
}

async function handleTabChange(tab) {
    activeTab = tab;
    if (tab === 'dashboard') {
        await ensureCurrentTeamGamesLoaded();
        updateDashboard();
        return;
    }
    if (tab === 'teams') {
        await ensureCurrentTeamOfficialsLoaded();
        renderCurrentTeamsView();
        return;
    }
    if (tab === 'users') {
        await ensureCurrentUsersOfficialsLoaded();
        renderCurrentUsersView();
        return;
    }
    if (tab === 'telemetry' && !telemetryState.loaded && !telemetryState.loading) {
        await loadTelemetryData();
        updateTelemetryDashboard();
    }
}

function setupTabs() {
    const tabs = ['dashboard', 'teams', 'users', 'telemetry'];
    tabs.forEach(tab => {
        document.getElementById(`tab-${tab}`).addEventListener('click', async () => {
            // Update tab styles
            tabs.forEach(t => {
                const btn = document.getElementById(`tab-${t}`);
                const view = document.getElementById(`view-${t}`);
                if (t === tab) {
                    btn.classList.add('text-primary-600', 'border-b-2', 'border-primary-600');
                    btn.classList.remove('text-gray-500');
                    view.classList.remove('hidden');
                } else {
                    btn.classList.remove('text-primary-600', 'border-b-2', 'border-primary-600');
                    btn.classList.add('text-gray-500');
                    view.classList.add('hidden');
                }
            });

            await handleTabChange(tab);
        });
    });
}

function setupSearch() {
    document.getElementById('officials-admin-form').addEventListener('submit', saveOfficialsAdmin);
    document.getElementById('officials-admin-list').addEventListener('click', handleOfficialsAdminListClick);
    document.getElementById('registration-form-editor').addEventListener('submit', saveRegistrationForm);

    const inactiveToggle = document.getElementById('filter-inactive-teams');
    if (inactiveToggle) {
        inactiveToggle.addEventListener('change', (e) => {
            showInactiveTeams = !!e.target.checked;
            updateDashboard();
            renderCurrentTeamsView();
        });
    }

    document.getElementById('search-teams').addEventListener('input', renderCurrentTeamsView);
    document.getElementById('search-users').addEventListener('input', renderCurrentUsersView);
    document.getElementById('filter-users-official-status')?.addEventListener('change', renderCurrentUsersView);
    document.getElementById('teams-prev-page')?.addEventListener('click', loadPreviousTeamsPage);
    document.getElementById('teams-next-page')?.addEventListener('click', loadNextTeamsPage);
    document.getElementById('users-prev-page')?.addEventListener('click', loadPreviousUsersPage);
    document.getElementById('users-next-page')?.addEventListener('click', loadNextUsersPage);

    const telemetryRange = document.getElementById('telemetry-range');
    const telemetryRefresh = document.getElementById('telemetry-refresh');
    const telemetryEventFilter = document.getElementById('telemetry-event-filter');
    const telemetryPageFilter = document.getElementById('telemetry-page-filter');

    telemetryRange?.addEventListener('change', async () => {
        await loadTelemetryData();
        updateTelemetryDashboard();
    });

    telemetryRefresh?.addEventListener('click', async () => {
        await loadTelemetryData();
        updateTelemetryDashboard();
    });

    telemetryEventFilter?.addEventListener('change', renderTelemetryEventsTable);
    telemetryPageFilter?.addEventListener('input', renderTelemetryEventsTable);
}

function getTeamOwnerEmail(team) {
    if (team.ownerEmail) return team.ownerEmail;
    // Try to find owner in allUsers
    if (team.ownerId) {
        const owner = getDashboardUsers().find(u => u.id === team.ownerId);
        if (owner) return owner.email;
    }
    // Fallback to first admin email
    if (team.adminEmails && team.adminEmails.length > 0) {
        return team.adminEmails[0] + (team.adminEmails.length > 1 ? ' +' : '');
    }
    return 'Unknown';
}
