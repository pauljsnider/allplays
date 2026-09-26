import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../player.html', import.meta.url), 'utf8');

describe('player public page load performance', () => {
    it('loads per-game stats in parallel instead of awaiting each game sequentially', () => {
        expect(source).toMatch(/async function loadPlayerGameData\(teamId, games, playerId, playerName, \{\s*requestManagerStats = false,\s*profilePlayerId = ''\s*\} = \{\}\) \{/);
        expect(source).toContain('const results = await Promise.all(games.map(async (game) => {');
        expect(source).not.toContain('for (const game of games) {');
    });

    it('reuses the initial game stats snapshot for selected-game insights', () => {
        expect(source).toContain('const selectedGameLoad = preparedGameLoadResults.find((entry) => entry.gameId === selectedGameId);');
        expect(source).toContain('const gameTeamStats = selectedGameLoad?.diamondGame');
        expect(source).toContain('? (selectedGameLoad.completeStatsByPlayerId || {})');
        expect(source).toContain(': (selectedGameLoad?.statsByPlayerId || {});');
        expect(source).not.toContain('const teamStatsSnapshot = await getDocs(collection(db, `teams/${teamId}/games/${selectedGameId}/aggregatedStats`));');
    });

    it('keeps the public profile bootable when optional per-game reads are denied', () => {
        expect(source).toContain("console.warn('Player stats unavailable for game:', gameId, error);");
        expect(source).toContain("console.warn('Player events unavailable for game:', gameId, error);");
        expect(source).toContain('playerGameStats: null,');
    });

    it('does not turn an unavailable Diamond stat head into authoritative empty play evidence', () => {
        expect(source).toContain("eventsLoadStatus: diamondGame && statsLoadStatus !== 'complete' ? 'unavailable' : 'complete'");
        expect(source).toContain("if (diamondGame && eventsLoadStatus !== 'complete') eventsLoadIncomplete = true;");
        expect(source).toContain('Diamond play-by-play could not be refreshed completely.');
        expect(source).toContain('No events recorded for this player');
    });
});
