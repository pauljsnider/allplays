import { getTeams, getAllUsers, deleteTeam } from './db.js';
import { renderHeader, renderFooter, escapeHtml } from './utils.js?v=8';
import { checkAuth } from './auth.js?v=9';

let allTeams = [];
let allUsers = [];
let currentUser = null; // Declare currentUser

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
        const [teams, users] = await Promise.all([getTeams(), getAllUsers()]);
        allTeams = teams;
        allUsers = users;

        // Load game stats for all teams
        await loadGameStats();

        updateDashboard();
        renderTeams(allTeams);
        renderUsers(allUsers);
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
            const { getGames } = await import('./db.js');
            const games = await getGames(team.id);
            return games.map(g => ({ ...g, teamId: team.id, teamName: team.name }));
        } catch (e) {
            return [];
        }
    });
    const gamesArrays = await Promise.all(gamesPromises);
    allGames = gamesArrays.flat();
}

function updateDashboard() {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Total teams with growth
    const newTeamsLast30 = allTeams.filter(t => t.createdAt && t.createdAt.toDate() > thirtyDaysAgo).length;
    document.getElementById('stat-total-teams').textContent = allTeams.length;
    document.getElementById('stat-teams-growth').textContent = `+${newTeamsLast30} this month`;

    // Total users with growth
    const newUsersLast30 = allUsers.filter(u => u.createdAt && u.createdAt.toDate() > thirtyDaysAgo).length;
    document.getElementById('stat-total-users').textContent = allUsers.length;
    document.getElementById('stat-users-growth').textContent = `+${newUsersLast30} this month`;

    // Total games
    const completedGames = allGames.filter(g => g.status === 'completed').length;
    const scheduledGames = allGames.filter(g => g.status === 'scheduled').length;
    document.getElementById('stat-total-games').textContent = allGames.length;
    document.getElementById('stat-games-breakdown').textContent = `${completedGames} played, ${scheduledGames} scheduled`;

    // Activity (teams with games in last 7 days)
    const activeTeams = new Set(allGames.filter(g => {
        const gameDate = g.date.toDate ? g.date.toDate() : new Date(g.date);
        return gameDate > sevenDaysAgo;
    }).map(g => g.teamId)).size;
    document.getElementById('stat-active-teams').textContent = activeTeams;
    document.getElementById('stat-activity-detail').textContent = `${activeTeams} teams with games`;

    // By Sport
    const sportCounts = {};
    allTeams.forEach(t => {
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
    const publicTeams = allTeams.filter(t => t.isPublic !== false).length;
    const privateTeams = allTeams.length - publicTeams;
    const teamsWithGames = new Set(allGames.map(g => g.teamId)).size;
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
    const recentTeams = [...allTeams]
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
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                    ${escapeHtml(team.sport || 'Unknown')}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${escapeHtml(team.zip || '-')}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${team.createdAt?.toDate ? team.createdAt.toDate().toLocaleDateString() : '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <a href="edit-team.html?teamId=${team.id}" class="text-indigo-600 hover:text-indigo-900 mr-4">Edit</a>
                <button onclick="window.deleteTeamAdmin('${team.id}', '${escapeHtml(team.name.replace(/'/g, "\\'"))}')" class="text-red-600 hover:text-red-900">Delete</button>
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
    if (confirm(`ADMIN ACTION: Are you sure you want to delete team "${teamName}"? This cannot be undone.`)) {
        try {
            await deleteTeam(teamId);
            alert('Team deleted.');
            await loadData(); // Reload
        } catch (e) {
            console.error(e);
            alert('Error deleting team: ' + e.message);
        }
    }
};

function setupTabs() {
    const tabs = ['dashboard', 'teams', 'users'];
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
        });
    });
}

function setupSearch() {
    document.getElementById('search-teams').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allTeams.filter(t =>
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
