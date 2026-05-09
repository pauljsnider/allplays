import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('admin dashboard statistics scope', () => {
    it('calculates game-based dashboard stats from the visible team set', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminJs).toContain('const visibleTeams = getVisibleTeams();');
        expect(adminJs).toContain('const visibleTeamIds = new Set(visibleTeams.map(team => team.id));');
        expect(adminJs).toContain('const visibleGames = allGames.filter(game => visibleTeamIds.has(game.teamId));');
        expect(adminJs).toContain("document.getElementById('stat-total-games').textContent = visibleGames.length;");
        expect(adminJs).toContain('const activeTeams = new Set(visibleGames.filter(g => {');
        expect(adminJs).toContain('const teamsWithGames = new Set(visibleGames.map(g => g.teamId)).size;');
    });
});
