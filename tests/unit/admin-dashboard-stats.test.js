import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

function renderRecentTeamAnchor(teamId) {
    const adminJs = fs.readFileSync('js/admin.js', 'utf8');
    const updateDashboardBody = adminJs.match(/function updateDashboard\(\)[\s\S]*?function renderRecentGameResults/)?.[0] || '';
    const anchorTemplate = updateDashboardBody.match(/<a href="edit-team\.html\?teamId=\$\{[^}]+\}"[^>]*>View →<\/a>/)?.[0];

    expect(anchorTemplate).toBeTruthy();
    return Function('team', `return \`${anchorTemplate}\`;`)({ id: teamId });
}

describe('admin dashboard statistics scope', () => {
    it('preserves complete team document IDs in recent-team navigation', () => {
        const teamId = 'normal team/id?season=fall&division=a';
        const dom = new JSDOM(`<div id="recent-team">${renderRecentTeamAnchor(teamId)}</div>`, {
            url: 'https://allplays.example/admin.html'
        });
        const anchor = dom.window.document.querySelector('#recent-team > a');

        expect(anchor).not.toBeNull();
        expect(anchor.getAttribute('href')).toBe(`edit-team.html?teamId=${encodeURIComponent(teamId)}`);
        expect(new URL(anchor.href).searchParams.get('teamId')).toBe(teamId);
    });

    it('keeps a cross-tenant creator-controlled document ID inert in recent-team markup', () => {
        const teamId = 'other-team\"><img src=x onerror="window.__unexpected=true"><a data-extra="';
        const dom = new JSDOM(`<div id="recent-team">${renderRecentTeamAnchor(teamId)}</div>`, {
            url: 'https://allplays.example/admin.html'
        });
        const container = dom.window.document.getElementById('recent-team');
        const anchor = container.querySelector('a');

        expect(container.querySelectorAll('a')).toHaveLength(1);
        expect(container.querySelectorAll('img')).toHaveLength(0);
        expect(anchor.getAttributeNames()).toEqual(['href', 'class']);
        expect(anchor.getAttribute('href')).not.toContain(teamId);
        expect(anchor.getAttribute('href')).toBe(`edit-team.html?teamId=${encodeURIComponent(teamId)}`);
        expect(new URL(anchor.href).searchParams.get('teamId')).toBe(teamId);
    });

    it('builds the initial dashboard from bounded first pages instead of full collections', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');
        const loadDataBody = adminJs.match(/async function loadData\(\)[\s\S]*?let allGames = \[\];/)?.[0] || '';
        const loadDashboardBody = adminJs.match(/async function loadDashboardData[\s\S]*?async function ensureCurrentTeamGamesLoaded/)?.[0] || '';

        expect(loadDataBody).toContain('getTeamsPage: getAdminTeamsPage');
        expect(loadDataBody).toContain('getUsersPage: getAdminUsersPage');
        expect(loadDataBody).toContain('teams: teamsPage.teams');
        expect(loadDataBody).toContain('users: usersPage.users');
        expect(loadDataBody).not.toContain('ensureCurrentTeamGamesLoaded()');
        expect(loadDashboardBody).toContain('buildBoundedAdminDashboardScope({ teams, users }');
        expect(loadDashboardBody).not.toContain('getTeams({ includeInactive: true })');
        expect(loadDashboardBody).not.toContain('getAllUsers()');
    });

    it('keeps initial reads and admin searches bounded', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');
        const teamSearchBody = adminJs.match(/async function getAdminTeamsForSearch[\s\S]*?async function getAdminUsersForSearch/)?.[0] || '';

        const adminHtml = fs.readFileSync('admin.html', 'utf8');

        expect(adminJs).toContain("import { checkAuth } from './auth.js?v=4433215';");
        expect(adminJs).not.toContain("import { checkAuth } from './auth.js?v=55';");
        expect(adminJs).toContain('loadInitialAdminBootstrap({');
        expect(adminJs).toContain('getTeamsPage: getAdminTeamsPage');
        expect(adminJs).toContain('getUsersPage: getAdminUsersPage');
        expect(adminJs).toContain('await Promise.all([');
        expect(adminJs).toContain('loadDashboardData()');
        expect(adminJs).toContain('ensureCurrentTeamGamesLoaded()');
        expect(adminJs).toContain('ensureCurrentTeamOfficialsLoaded()');
        expect(adminJs).toContain('await ensureCurrentUsersOfficialsLoaded();');
        expect(adminHtml).toContain('id="teams-pagination-status"');
        expect(adminHtml).toContain('id="users-pagination-status"');
        expect(adminJs).toContain('createDebouncedAdminTeamSearch({');
        expect(adminJs).toContain('search: searchAdminTeams');
        expect(adminJs).not.toContain('loadCompleteAdminSearchCollection({');
        expect(adminJs).toContain('createDebouncedAdminUserSearch({');
        expect(adminJs).toContain('search: searchAdminUsers');
        expect(teamSearchBody).not.toContain('fetchPage: getAdminTeamsPage');
        expect(adminJs).not.toContain('globalSearchTeamsPromise = getTeams(');
        expect(adminJs).not.toContain('globalSearchUsersPromise = getAllUsers(');
    });

    it('preserves complete shared team and user helpers through bounded internal pages', () => {
        const dbJs = fs.readFileSync('js/db.js', 'utf8');
        const pagingHelper = dbJs.match(/async function getAllOrderedCollectionDocuments[\s\S]*?\n\}/)?.[0] || '';
        const getTeamsBody = dbJs.match(/export async function getTeams\(options = \{\}\)[\s\S]*?\n\}/)?.[0] || '';
        const getAllUsersBody = dbJs.match(/export async function getAllUsers\(\)[\s\S]*?\n\}/)?.[0] || '';

        expect(pagingHelper).toContain('limitQuery(COMPLETE_COLLECTION_PAGE_SIZE)');
        expect(pagingHelper).toContain('startAfterQuery(cursor)');
        expect(pagingHelper).toContain('} while (cursor);');
        expect(getTeamsBody).toContain('getAllOrderedCollectionDocuments(teamsRef, "name")');
        expect(getAllUsersBody).toContain('getAllOrderedCollectionDocuments(collection(db, "users"), "email")');
        expect(getTeamsBody).not.toContain('limitQuery(100)');
        expect(getAllUsersBody).not.toContain('limitQuery(100)');
    });

    it('uses distinct bounded game windows for dashboard and Teams-tab page reads', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');
        const officialsHelperJs = fs.readFileSync('js/admin-team-officials.js', 'utf8');
        const loadGameStatsBody = adminJs.match(/async function loadGameStatsForTeams[\s\S]*?async function loadDashboardData/)?.[0] || '';

        expect(adminJs).toContain('const DASHBOARD_GAME_LOOKBACK_DAYS = 30;');
        expect(adminJs).toContain('const DASHBOARD_GAME_LOOKAHEAD_DAYS = 30;');
        expect(adminJs).toContain('const DASHBOARD_SUMMARY_TEAM_LIMIT = DEFAULT_ADMIN_PAGE_SIZE;');
        expect(loadGameStatsBody).toContain("scope === 'dashboard'");
        expect(loadGameStatsBody).toContain('buildDashboardGameQueryWindow()');
        expect(loadGameStatsBody).toContain('await getGames(team.id, dashboardGameQueryWindow)');
        expect(loadGameStatsBody).toContain('await loadAdminTeamOfficialsCoverageGames(teams, getGames)');
        expect(loadGameStatsBody).not.toContain('await getGames(team.id);');
        expect(officialsHelperJs).toContain('await getGamesForTeam(team.id, coverageWindow)');
        expect(loadGameStatsBody).not.toContain('getCountFromServer');
        expect(adminJs).not.toContain('loadDashboardAllTimeGameStats');
    });

    it('labels dashboard values as loaded-page and recent-window counts', () => {
        const adminHtml = fs.readFileSync('admin.html', 'utf8');
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminHtml).toContain('Loaded Teams');
        expect(adminHtml).toContain('Loaded Users');
        expect(adminHtml).toContain('Recent Games');
        expect(adminJs).toContain('Loaded page · +${newTeamsLast30} this month');
        expect(adminJs).toContain('Loaded page · +${newUsersLast30} this month');
        expect(adminJs).toContain('±30 days · ${completedGames} played, ${scheduledGames} scheduled');
        expect(adminJs).toContain('const teamsWithGames = new Set(visibleRecentGames.map(game => game.teamId)).size;');
        expect(adminJs).toContain('With Recent Games');
    });

    it('defers bounded team coverage reads until the Teams tab or explicit pagination', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');
        const handleTabBody = adminJs.match(/async function handleTabChange[\s\S]*?function setupTabs/)?.[0] || '';

        expect(handleTabBody).toContain("if (tab === 'dashboard')");
        expect(handleTabBody).toContain('await loadDashboardData();');
        expect(handleTabBody).toContain("if (tab === 'teams')");
        expect(handleTabBody).toContain('ensureCurrentTeamGamesLoaded()');
        expect(handleTabBody).toContain('ensureCurrentTeamOfficialsLoaded()');
    });
});
