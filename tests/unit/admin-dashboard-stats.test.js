import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('admin dashboard statistics scope', () => {
    it('calculates dashboard stats from the full admin datasets instead of the current page', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminJs).toContain('const sourceTeams = getDashboardTeams();');
        expect(adminJs).toContain('const sourceUsers = getDashboardUsers();');
        expect(adminJs).toContain("const visibleTeams = showInactiveTeams ? sourceTeams : sourceTeams.filter(isTeamActive);");
        expect(adminJs).toContain('const visibleTeamIds = new Set(visibleTeams.map(team => team.id));');
        expect(adminJs).toContain('const visibleGames = dashboardGames.filter(game => visibleTeamIds.has(game.teamId));');
        expect(adminJs).toContain("document.getElementById('stat-total-users').textContent = sourceUsers.length;");
        expect(adminJs).toContain('const teamsWithGames = new Set(visibleGames.map(g => g.teamId)).size;');
    });

    it('boots from paged teams and users before lazy team detail fan-out', () => {
        const adminHtml = fs.readFileSync('admin.html', 'utf8');
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminJs).toContain('loadInitialAdminBootstrap({');
        expect(adminJs).toContain('getTeamsPage: getAdminTeamsPage');
        expect(adminJs).toContain('getUsersPage: getAdminUsersPage');
        expect(adminJs).toContain('await Promise.all([');
        expect(adminJs).toContain('loadDashboardData()');
        expect(adminJs).toContain('await ensureAllOfficialsLoaded();');
        expect(adminHtml).toContain('id="teams-pagination-status"');
        expect(adminHtml).toContain('id="users-pagination-status"');
    });
});
