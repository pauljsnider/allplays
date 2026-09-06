import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readRootFile = (fileName) => readFileSync(new URL(`../../${fileName}`, import.meta.url), 'utf8');

describe('legacy Diamond stat surface contracts', () => {
    it('loads one versioned coverage helper on every legacy report surface', () => {
        for (const fileName of ['game.html', 'player.html', 'team.html']) {
            expect(readRootFile(fileName)).toContain("from './js/diamond-stat-presentation.js?v=6'");
        }
    });

    it('loads Diamond player stats only from the current generation while preserving classic collections', () => {
        const helperSource = readRootFile('js/diamond-stat-presentation.js');
        expect(helperSource).toContain('diamondStatGenerations/${identity.instanceId}/publicPlayerStats');
        expect(helperSource).toContain('resolveDiamondPublicStatDocuments');

        for (const fileName of ['game.html', 'player.html', 'team.html']) {
            const source = readRootFile(fileName);
            expect(source).toContain('getDiamondPublicPlayerStatsCollectionPath');
            expect(source).toContain('resolveDiamondPublicStatDocuments');
            expect(source).toContain('/aggregatedStats`');
        }
    });

    it('keeps Diamond reports read only and never ranks unavailable values as zero', () => {
        const gameSource = readRootFile('game.html');
        const playerSource = readRootFile('player.html');
        const teamSource = readRootFile('team.html');

        expect(gameSource).toContain('const diamondGame = isDiamondV2Game(game);');
        expect(gameSource).toContain('if (diamondGame) {');
        expect(gameSource).toContain('canEditStats = false;');
        expect(gameSource).toContain("getManagerDiamondStatCatalog(resolvedConfig, 'team')");
        expect(gameSource).toContain('resolveDiamondPublicTeamStatDocument');
        expect(gameSource).toContain("statVisibility === 'manager-internal'");
        expect(gameSource).toContain('if (canEditStats && !diamondGame)');
        expect(gameSource).toContain('loadDiamondManagerStats');
        expect(playerSource).toContain("getPublicDiamondStatCatalog(resolvedDiamondConfig, 'player')");
        expect(playerSource).toContain('loadDiamondManagerStats');
        expect(playerSource).toContain('completeStatsByPlayerId');
        expect(teamSource).toContain('Object.prototype.hasOwnProperty.call(stats, definition.id)');
        expect(teamSource).toContain('Missing or partially captured stats are not treated as zero.');
        expect(teamSource).toContain('aggregateCoverageAwareTeamStats');
        expect(teamSource).toContain('loadDiamondManagerStats');
        expect(teamSource).toContain("recordType: 'season_team'");
    });

    it('renders unavailable Diamond values as an em dash and labels partial observations', () => {
        const gameSource = readRootFile('game.html');
        const playerSource = readRootFile('player.html');

        expect(gameSource).toContain("const value = displayed.available ? escapeHtml(displayed.text) : '&mdash;';");
        expect(gameSource).toContain('Observed from partial tracking');
        expect(playerSource).toContain("const value = displayed.available ? escapeHtml(displayed.text) : '&mdash;';");
        expect(playerSource).toContain('Observed from partial tracking');
    });

    it('offers coverage-aware CSV only on Diamond game, player, and season stat paths', () => {
        const gameSource = readRootFile('game.html');
        const playerSource = readRootFile('player.html');
        const teamSource = readRootFile('team.html');

        for (const source of [gameSource, playerSource, teamSource]) {
            expect(source).toContain("from './js/diamond-stat-export.js?v=6'");
            expect(source).toContain('buildDiamondStatsCsv');
            expect(source).toContain('downloadDiamondStatsCsv');
        }
        expect(gameSource).toContain('id="diamond-stats-export-btn"');
        expect(gameSource).toContain('if (!isDiamondV2Game(game))');
        expect(gameSource).toContain('documentsComplete: diamondDocumentsComplete');
        expect(playerSource).toContain('id="diamond-player-stats-export-btn"');
        expect(playerSource).toContain('if (diamondExportButton && hasDiamondStats)');
        expect(playerSource).toContain("recordType: 'season_player'");
        expect(teamSource).toContain('data-diamond-season-export');
        expect(teamSource).toContain('...(coverageAwareSeason.presentationByPlayerId[player.id] || {');
    });
});
