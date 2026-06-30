import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('track-live finish playing time persistence', () => {
    it('saves current player field elapsed time when completing a live game', () => {
        const source = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');
        const finishStatsBlock = source.match(/\/\/ 2\. Write aggregated stats for each player[\s\S]*?\/\/ 3\. Update game document with final data/)?.[0] || '';

        expect(finishStatsBlock).toContain('const timeMs = getPlayerFieldElapsedMs(');
        expect(finishStatsBlock).toContain('gameState.playerFieldStatus');
        expect(finishStatsBlock).toContain('gameState.isRunning ? Date.now() : null');
        expect(finishStatsBlock).toMatch(/batch\.set\(statsRef, \{[\s\S]*stats: stats,[\s\S]*timeMs[\s\S]*\}\);/);
    });

    it('persists appeared players who logged field time without recording a stat', () => {
        const source = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');
        const finishStatsBlock = source.match(/\/\/ 2\. Write aggregated stats for each player[\s\S]*?\/\/ 3\. Update game document with final data/)?.[0] || '';

        expect(finishStatsBlock).toContain('const playerIdsToPersist = new Set(Object.keys(gameState.playerStats));');
        expect(finishStatsBlock).toContain("fieldStatus?.status === 'onField' || timeMs > 0");
        expect(finishStatsBlock).toContain('playerIdsToPersist.add(playerId);');
        expect(finishStatsBlock).toContain('const stats = gameState.playerStats[playerId] || {};');
        expect(finishStatsBlock).toContain("participationSource: 'legacy-live-tracker-finish'");
        expect(finishStatsBlock).not.toContain('for (const [playerId, stats] of Object.entries(gameState.playerStats))');
    });
});
