import {
    getTeams,
    getAllUsers,
    deleteTeam,
    getTelemetryEvents,
    getTelemetryDaily,
    getTelemetryPageDaily,
    getTelemetryEventDaily,
    getTelemetrySessions
} from './db.js?v=31';
import { db, collection, getDocs, doc, setDoc, updateDoc, serverTimestamp } from './firebase.js?v=15';
import { renderHeader, renderFooter, escapeHtml } from './utils.js?v=8';
import { checkAuth } from './auth.js?v=15';
import {
    adminRegistrationDefaults,
    buildAdminRegistrationFormPayload,
    formatFieldLabels,
    formatRegistrationDiscountRulesText,
    parseRegistrationDiscountRulesText,
    getAdminRegistrationShareUrl,
    validateAdminRegistrationFormPayload
} from './admin-registration-forms.js?v=3';

let allTeams = [];
let allUsers = [];
let currentUser = null; // Declare currentUser
let showInactiveTeams = false;
let activeRegistrationTeam = null;
let activeRegistrationForms = [];
let activeRegistrationOptions = [];

function inlineJsString(value) {
    return escapeHtml(JSON.stringify(String(value || '')));
}
let telemetryState = {
    loaded: false,
    loading: false,
    error: null,
    days: 7,
    events: [],
    daily: [],
    pages: [],
    eventDaily: [],
    sessions: []
};

function isTeamActive(team) {
    return team?.active !== false;
}

function getVisibleTeams() {
    return showInactiveTeams ? allTeams : allTeams.filter(isTeamActive);
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
        const [teams, users] = await Promise.all([getTeams({ includeInactive: true }), getAllUsers()]);
        allTeams = teams;
        allUsers = users;

        // Load game stats for all teams and telemetry in parallel after core data is available.
        await Promise.all([
            loadGameStats(),
            loadTelemetryData({ silent: true })
        ]);

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

async function loadGameStats() {
    // Load games from all teams
    const gamesPromises = allTeams.map(async (team) => {
        try {
            const { getGames } = await import('./db.js?v=31');
            const games = await getGames(team.id);
            return games.map(g => ({ ...g, teamId: team.id, teamName: team.name }));
        } catch (e) {
            return [];
        }
    });
    const gamesArrays = await Promise.all(gamesPromises);
    allGames = gamesArrays.flat();
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
        const [events, daily, pages, eventDaily, sessions] = await Promise.all([
            getTelemetryEvents({ days, maxEvents }),
            getTelemetryDaily({ days }),
            getTelemetryPageDaily({ days }),
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
            eventDaily: [],
            sessions: []
        };
        if (status) {
            status.textContent = `Telemetry could not be loaded: ${error.message}`;
        }
    }
}

function updateDashboard() {
    const visibleTeams = getVisibleTeams();
    const visibleTeamIds = new Set(visibleTeams.map(team => team.id));
    const visibleGames = allGames.filter(game => visibleTeamIds.has(game.teamId));
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Total teams with growth
    const newTeamsLast30 = visibleTeams.filter(t => t.createdAt && t.createdAt.toDate() > thirtyDaysAgo).length;
    document.getElementById('stat-total-teams').textContent = visibleTeams.length;
    document.getElementById('stat-teams-growth').textContent = `+${newTeamsLast30} this month`;

    // Total users with growth
    const newUsersLast30 = allUsers.filter(u => u.createdAt && u.createdAt.toDate() > thirtyDaysAgo).length;
    document.getElementById('stat-total-users').textContent = allUsers.length;
    document.getElementById('stat-users-growth').textContent = `+${newUsersLast30} this month`;

    // Total games
    const completedGames = visibleGames.filter(g => g.status === 'completed').length;
    const scheduledGames = visibleGames.filter(g => g.status === 'scheduled').length;
    document.getElementById('stat-total-games').textContent = visibleGames.length;
    document.getElementById('stat-games-breakdown').textContent = `${completedGames} played, ${scheduledGames} scheduled`;

    // Activity (teams with games in last 7 days)
    const activeTeams = new Set(visibleGames.filter(g => {
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
    const teamsWithGames = new Set(visibleGames.map(g => g.teamId)).size;
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
    const recentUsersList = [...allUsers]
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

function getFilteredTelemetryEvents() {
    const eventFilter = document.getElementById('telemetry-event-filter')?.value || '';
    const pageFilter = (document.getElementById('telemetry-page-filter')?.value || '').toLowerCase();
    return telemetryState.events.filter((event) => {
        const eventMatches = !eventFilter || event.name === eventFilter;
        const pageMatches = !pageFilter || (event.pagePath || '').toLowerCase().includes(pageFilter);
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

function renderTopTelemetryEvents() {
    const grouped = groupTelemetry(telemetryState.eventDaily, 'name', 'count').slice(0, 20);
    renderTelemetryList('telemetry-top-events', grouped, ({ key, count }) => `
        <div class="flex items-center justify-between gap-3 border-b border-gray-100 pb-2 last:border-0">
            <span class="text-sm font-medium text-gray-800 truncate">${escapeHtml(key)}</span>
            <span class="text-sm font-semibold text-gray-900">${telemetryNumber(count)}</span>
        </div>
    `, 'No event telemetry has been recorded for this range.');
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
                    <p class="font-medium text-gray-900 truncate">${escapeHtml(session.lastPage || session.entryPage || '-')}</p>
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
        return `
            <tr>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${createdAt ? createdAt.toLocaleString() : '-'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${escapeHtml(event.name || '-')}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${escapeHtml(event.pagePath || '-')}</td>
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
        renderEmptyTelemetry('telemetry-top-pages', errorMessage);
        renderEmptyTelemetry('telemetry-top-events', errorMessage);
        renderEmptyTelemetry('telemetry-recent-sessions', errorMessage);

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

    renderTelemetryTrend();
    renderTopTelemetryPages();
    renderTopTelemetryEvents();
    renderRecentTelemetrySessions();
    renderTelemetryEventsTable();
}

function renderTeams(teams) {
    const tbody = document.getElementById('teams-table-body');
    tbody.innerHTML = teams.map(team => `
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
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button onclick="window.openRegistrationFormsAdmin(${inlineJsString(team.id)})" class="text-indigo-600 hover:text-indigo-900 mr-4">Registration forms</button>
                <a href="edit-team.html?teamId=${team.id}" class="text-indigo-600 hover:text-indigo-900 mr-4">Edit</a>
                <button onclick="window.deleteTeamAdmin(${inlineJsString(team.id)}, ${inlineJsString(team.name)})" class="text-red-600 hover:text-red-900">Deactivate</button>
            </td>
        </tr>
    `).join('');
}

function renderUsers(users) {
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = users.map(u => {
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
                ${escapeHtml(u.email || '-')}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${escapeHtml(u.fullName || '-')}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${escapeHtml(u.phone || '-')}
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
    activeRegistrationTeam = allTeams.find(team => team.id === teamId) || null;
    if (!activeRegistrationTeam) return;

    document.getElementById('registration-team-name').textContent = activeRegistrationTeam.name || 'Team';
    document.getElementById('registration-form-editor').classList.add('hidden');
    document.getElementById('registration-forms-modal').classList.remove('hidden');
    await loadRegistrationFormsForActiveTeam();
};

window.closeRegistrationFormsAdmin = function () {
    document.getElementById('registration-forms-modal').classList.add('hidden');
};

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
    activeRegistrationOptions = Array.isArray(form.registrationOptions) ? form.registrationOptions.map(option => ({ ...option })) : [];
    renderRegistrationOptionsEditor();
    document.getElementById('registration-waiver').value = form.waiverText || '';
    document.getElementById('registration-status').value = form.status === 'published' || form.published === true ? 'published' : 'draft';
    document.getElementById('registration-form-message').textContent = '';
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
        const published = form.status === 'published' || form.published === true;
        const link = getAdminRegistrationShareUrl(activeRegistrationTeam.id, form.id, window.location.origin);
        const teamIdArg = inlineJsString(activeRegistrationTeam.id);
        const formIdArg = inlineJsString(form.id);
        return `
            <div class="rounded border border-gray-200 p-3">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <p class="font-semibold text-gray-900">${escapeHtml(form.programName || form.title || 'Untitled form')}</p>
                        <p class="text-xs text-gray-500">${escapeHtml(form.programType || 'season')} • ${published ? 'Published' : 'Draft'}</p>
                    </div>
                    <button onclick="window.startRegistrationFormAdmin(${formIdArg})" class="text-sm text-indigo-600 hover:text-indigo-800">Edit</button>
                </div>
                ${published ? `<div class="mt-2 rounded bg-green-50 p-2 text-xs text-green-800 break-all">${escapeHtml(link)} <button onclick="window.copyRegistrationLinkAdmin(${teamIdArg}, ${formIdArg})" class="ml-2 font-semibold underline">Copy</button></div>` : '<p class="mt-2 text-xs text-gray-500">Publish to generate a parent-facing registration link.</p>'}
            </div>
        `;
    }).join('');
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

    message.textContent = payload.published ? 'Registration form saved and published.' : 'Registration form saved as draft.';
    if (activeRegistrationTeam?.id === teamId) {
        await loadRegistrationFormsForActiveTeam();
        document.getElementById('registration-form-editor').classList.add('hidden');
    }
}

function setupTabs() {
    const tabs = ['dashboard', 'teams', 'users', 'telemetry'];
    tabs.forEach(tab => {
        document.getElementById(`tab-${tab}`).addEventListener('click', () => {
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

            if (tab === 'telemetry' && !telemetryState.loaded && !telemetryState.loading) {
                loadTelemetryData().then(updateTelemetryDashboard);
            }
        });
    });
}

function setupSearch() {
    document.getElementById('registration-form-editor').addEventListener('submit', saveRegistrationForm);

    const inactiveToggle = document.getElementById('filter-inactive-teams');
    if (inactiveToggle) {
        inactiveToggle.addEventListener('change', (e) => {
            showInactiveTeams = !!e.target.checked;
            updateDashboard();
            renderTeams(getVisibleTeams());
        });
    }

    document.getElementById('search-teams').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = getVisibleTeams().filter(t =>
            (t.name || '').toLowerCase().includes(term) ||
            (t.sport || '').toLowerCase().includes(term)
        );
        renderTeams(filtered);
    });

    document.getElementById('search-users').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allUsers.filter(u =>
            (u.email || '').toLowerCase().includes(term) ||
            (u.fullName || '').toLowerCase().includes(term)
        );
        renderUsers(filtered);
    });

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
        const owner = allUsers.find(u => u.id === team.ownerId);
        if (owner) return owner.email;
    }
    // Fallback to first admin email
    if (team.adminEmails && team.adminEmails.length > 0) {
        return team.adminEmails[0] + (team.adminEmails.length > 1 ? ' +' : '');
    }
    return 'Unknown';
}
