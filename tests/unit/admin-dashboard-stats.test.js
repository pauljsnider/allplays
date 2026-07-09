import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('admin dashboard statistics scope', () => {
    it('calculates dashboard stats from the full admin datasets instead of the current page', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminJs).toContain('const sourceTeams = getDashboardTeams();');
        expect(adminJs).toContain('const sourceUsers = getDashboardUsers();');
        expect(adminJs).toContain("const visibleTeams = showInactiveTeams ? sourceTeams : sourceTeams.filter(isTeamActive);");
        expect(adminJs).toContain('const visibleTeamIds = new Set(visibleTeams.map(team => team.id));');
        expect(adminJs).toContain('const visibleRecentGames = dashboardGames.filter(game => visibleTeamIds.has(game.teamId));');
        expect(adminJs).toContain("document.getElementById('stat-total-users').textContent = sourceUsers.length;");
        expect(adminJs).toContain('const visibleAllTimeGameStats = visibleTeams.reduce((totals, team) => {');
        expect(adminJs).toContain("document.getElementById('stat-total-games').textContent = visibleAllTimeGameStats.total;");
        expect(adminJs).toContain('const teamsWithGames = visibleAllTimeGameStats.teamsWithGames;');
    });

    it('boots from paged teams and users before lazy team detail fan-out', () => {
        const adminHtml = fs.readFileSync('admin.html', 'utf8');
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminJs).toContain("import { checkAuth } from './auth.js?v=44';");
        expect(adminJs).not.toContain("import { checkAuth } from './auth.js?v=42';");
        expect(adminJs).toContain('loadInitialAdminBootstrap({');
        expect(adminJs).toContain('getTeamsPage: getAdminTeamsPage');
        expect(adminJs).toContain('getUsersPage: getAdminUsersPage');
        expect(adminJs).toContain('await Promise.all([');
        expect(adminJs).toContain('loadDashboardData()');
        expect(adminJs).toContain('ensureCurrentTeamGamesLoaded()');
        expect(adminJs).toContain('await ensureCurrentTeamOfficialsLoaded();');
        expect(adminJs).toContain('await ensureCurrentUsersOfficialsLoaded();');
        expect(adminHtml).toContain('id="teams-pagination-status"');
        expect(adminHtml).toContain('id="users-pagination-status"');
    });

    it('bounds dashboard game reads while preserving page-scope full-history reads', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');
        const loadGameStatsBody = adminJs.match(/async function loadGameStatsForTeams[\s\S]*?async function loadDashboardData\(\)/)?.[0] || '';

        expect(adminJs).toContain('const DASHBOARD_GAME_LOOKBACK_DAYS = 30;');
        expect(adminJs).toContain('const DASHBOARD_GAME_LOOKAHEAD_DAYS = 30;');
        expect(loadGameStatsBody).toContain("scope === 'dashboard'");
        expect(loadGameStatsBody).toContain('buildDashboardGameQueryWindow()');
        expect(loadGameStatsBody).toContain('await getGames(team.id, dashboardGameQueryWindow)');
        expect(loadGameStatsBody).toContain('await getGames(team.id);');
        expect(loadGameStatsBody).toContain('await loadDashboardAllTimeGameStats(teams);');
        expect(loadGameStatsBody).toContain('loadedDashboardGamesKey = teamsKey;');
    });

    it('keeps all-time dashboard game totals separate from bounded recent-game reads', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminJs).toContain('let dashboardGameStatsByTeamId = new Map();');
        expect(adminJs).toContain('async function loadDashboardAllTimeGameStats(teams = [])');
        expect(adminJs).toContain('getCountFromServer(gamesRef)');
        expect(adminJs).toContain("getCountFromServer(query(gamesRef, where('status', '==', 'completed')))");
        expect(adminJs).toContain("getCountFromServer(query(gamesRef, where('status', '==', 'scheduled')))");
        expect(adminJs).toContain('totals.total += stats.total;');
        expect(adminJs).toContain('totals.completed += stats.completed;');
        expect(adminJs).toContain('totals.scheduled += stats.scheduled;');
        expect(adminJs).toContain('if (stats.total > 0) totals.teamsWithGames += 1;');
        expect(adminJs).toContain('renderRecentGameResults(visibleRecentGames);');
    });
});
