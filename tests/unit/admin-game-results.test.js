import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildRecentGameResultsRows, formatGameResult } from '../../js/admin-game-results.js';

function ts(date) {
    return { toDate: () => new Date(date) };
}

describe('admin recent game results', () => {
    it('filters to completed or scored games and sorts newest first', () => {
        const rows = buildRecentGameResultsRows([
            { id: 'scheduled', teamId: 'team-1', teamName: 'Blue', opponent: 'Gold', status: 'scheduled', date: ts('2026-01-03T12:00:00Z') },
            { id: 'default-score', teamId: 'team-1', teamName: 'Blue', opponent: 'Yellow', status: 'scheduled', homeScore: 0, awayScore: 0, date: ts('2026-01-05T12:00:00Z') },
            { id: 'old', teamId: 'team-2', teamName: 'Red', opponent: 'Green', status: 'completed', homeScore: 1, awayScore: 2, date: ts('2026-01-01T12:00:00Z') },
            { id: 'new', teamId: 'team-3', teamName: 'White', opponent: 'Black', status: 'scheduled', homeScore: 4, awayScore: 3, date: ts('2026-01-04T12:00:00Z') },
            { id: 'middle', teamId: 'team-4', teamName: 'Gray', opponent: 'Orange', status: 'completed', date: ts('2026-01-02T12:00:00Z') }
        ]);

        expect(rows.map(row => row.gameId)).toEqual(['new', 'middle', 'old']);
        expect(rows[0]).toMatchObject({ teamName: 'White', opponent: 'Black', score: '4-3', status: 'Scored' });
        expect(rows[1]).toMatchObject({ score: 'No score', status: 'Played' });
    });

    it('formats win, loss, tie, and missing scores', () => {
        expect(formatGameResult({ status: 'completed', homeScore: 5, awayScore: 3 })).toEqual({ score: '5-3', status: 'Win' });
        expect(formatGameResult({ status: 'completed', homeScore: 2, awayScore: 4 })).toEqual({ score: '2-4', status: 'Loss' });
        expect(formatGameResult({ status: 'completed', homeScore: 1, awayScore: 1 })).toEqual({ score: '1-1', status: 'Tie' });
        expect(formatGameResult({ status: 'completed' })).toEqual({ score: 'No score', status: 'Played' });
    });

    it('wires the admin dashboard container and renderer', () => {
        const adminHtml = fs.readFileSync('admin.html', 'utf8');
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminHtml).toContain('Recent Game Results');
        expect(adminHtml).toContain('id="recent-game-results"');
        expect(adminJs).toContain("import { buildRecentGameResultsRows } from './admin-game-results.js?v=1';");
        expect(adminJs).toContain('const visibleTeamIds = new Set(visibleTeams.map(team => team.id));');
        expect(adminJs).toContain('const visibleRecentGames = dashboardGames.filter(game => visibleTeamIds.has(game.teamId));');
        expect(adminJs).toContain('renderRecentGameResults(visibleRecentGames);');
        expect(adminJs).toContain('No completed or scored game results yet.');
        expect(adminJs).toContain('Game Report →');
        expect(adminJs).toContain('game.html#teamId=');
    });
});
