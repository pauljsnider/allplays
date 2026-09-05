import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readRootFile = (fileName) => readFileSync(new URL(`../../${fileName}`, import.meta.url), 'utf8');

describe('legacy Diamond stat surface contracts', () => {
    it('loads one versioned coverage helper on every legacy report surface', () => {
        for (const fileName of ['game.html', 'player.html', 'team.html']) {
            expect(readRootFile(fileName)).toContain("from './js/diamond-stat-presentation.js?v=1'");
        }
    });

    it('keeps Diamond reports read only and never ranks unavailable values as zero', () => {
        const gameSource = readRootFile('game.html');
        const playerSource = readRootFile('player.html');
        const teamSource = readRootFile('team.html');

        expect(gameSource).toContain('const diamondGame = isDiamondV2Game(game);');
        expect(gameSource).toContain('if (diamondGame) {');
        expect(gameSource).toContain('canEditStats = false;');
        expect(gameSource).toContain('getPublicDiamondStatCatalog(resolvedConfig, \'team\')');
        expect(playerSource).toContain("getPublicDiamondStatCatalog(resolvedDiamondConfig, 'player')");
        expect(playerSource).toContain('completeStatsByPlayerId');
        expect(teamSource).toContain('Object.prototype.hasOwnProperty.call(completeStatsByPlayerId[player.id] || {}, definition.id)');
        expect(teamSource).toContain('Missing or partially captured stats are not treated as zero.');
    });

    it('renders unavailable Diamond values as an em dash and labels partial observations', () => {
        const gameSource = readRootFile('game.html');
        const playerSource = readRootFile('player.html');

        expect(gameSource).toContain("const value = displayed.available ? escapeHtml(displayed.text) : '&mdash;';");
        expect(gameSource).toContain('Observed from partial tracking');
        expect(playerSource).toContain("const value = displayed.available ? escapeHtml(displayed.text) : '&mdash;';");
        expect(playerSource).toContain('Observed from partial tracking');
    });
});
