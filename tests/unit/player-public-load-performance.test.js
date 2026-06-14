import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../player.html', import.meta.url), 'utf8');

describe('player public page load performance', () => {
    it('loads per-game stats in parallel instead of awaiting each game sequentially', () => {
        expect(source).toContain('async function loadPlayerGameData(teamId, games, playerId, playerName) {');
        expect(source).toContain('return Promise.all(games.map(async (game) => {');
        expect(source).not.toContain('for (const game of games) {');
    });

    it('reuses the initial game stats snapshot for selected-game insights', () => {
        expect(source).toContain('const gameTeamStats = gameLoadResults.find((entry) => entry.gameId === selectedGameId)?.statsByPlayerId || {};');
        expect(source).not.toContain('const teamStatsSnapshot = await getDocs(collection(db, `teams/${teamId}/games/${selectedGameId}/aggregatedStats`));');
    });
});
