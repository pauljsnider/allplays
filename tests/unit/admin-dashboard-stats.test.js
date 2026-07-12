import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('admin dashboard statistics scope', () => {
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

    it('uses bounded page loaders for explicit broader admin searches', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        const adminHtml = fs.readFileSync('admin.html', 'utf8');

        expect(adminJs).toContain("import { checkAuth } from './auth.js?v=48';");
        expect(adminJs).not.toContain("import { checkAuth } from './auth.js?v=42';");
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
        expect(adminJs).toContain('getAdminTeamsPage({ pageSize: 100 })');
        expect(adminJs).toContain('getAdminUsersPage({ pageSize: 100 })');
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

    it('bounds dashboard game reads to the loaded team page and a recent time window', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');
        const loadGameStatsBody = adminJs.match(/async function loadGameStatsForTeams[\s\S]*?async function loadDashboardData/)?.[0] || '';

        expect(adminJs).toContain('const DASHBOARD_GAME_LOOKBACK_DAYS = 30;');
        expect(adminJs).toContain('const DASHBOARD_GAME_LOOKAHEAD_DAYS = 30;');
        expect(adminJs).toContain('const DASHBOARD_SUMMARY_TEAM_LIMIT = DEFAULT_ADMIN_PAGE_SIZE;');
        expect(loadGameStatsBody).toContain("scope === 'dashboard'");
        expect(loadGameStatsBody).toContain('buildDashboardGameQueryWindow()');
        expect(loadGameStatsBody).toContain('await getGames(team.id, dashboardGameQueryWindow)');
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

    it('defers full-history team game reads until the Teams tab or explicit pagination', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');
        const handleTabBody = adminJs.match(/async function handleTabChange[\s\S]*?function setupTabs/)?.[0] || '';

        expect(handleTabBody).toContain("if (tab === 'dashboard')");
        expect(handleTabBody).toContain('await loadDashboardData();');
        expect(handleTabBody).toContain("if (tab === 'teams')");
        expect(handleTabBody).toContain('ensureCurrentTeamGamesLoaded()');
        expect(handleTabBody).toContain('ensureCurrentTeamOfficialsLoaded()');
    });
});
