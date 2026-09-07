import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readRootFile = (fileName) => readFileSync(new URL(`../../${fileName}`, import.meta.url), 'utf8');

function loadConfiguredLeaderboardPlayerRenderer() {
    const source = readRootFile('team.html');
    const start = source.indexOf('function renderConfiguredLeaderboardPlayer(entry, teamId) {');
    const end = source.indexOf('\n\n        function renderConfiguredTeamLeaderboards(', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const functionSource = source.slice(start, end);
    return new Function('escapeHtml', `
        ${functionSource}
        return renderConfiguredLeaderboardPlayer;
    `)((value) => String(value ?? ''));
}

describe('legacy Diamond stat surface contracts', () => {
    it('loads one versioned coverage helper on every legacy report surface', () => {
        for (const fileName of ['game.html', 'player.html', 'team.html']) {
            expect(readRootFile(fileName)).toContain("from './js/diamond-stat-presentation.js?v=7'");
            expect(readRootFile(fileName)).toContain("from './js/diamond-manager-stats.js?v=5'");
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

    it('loads report play evidence through bounded Diamond callables while retaining legacy event reads', () => {
        const gameSource = readRootFile('game.html');
        const playerSource = readRootFile('player.html');
        const helperSource = readRootFile('js/diamond-report-events.js');

        for (const source of [gameSource, playerSource]) {
            expect(source).toContain("from './js/diamond-report-events.js?v=1'");
            expect(source).toContain('loadCompleteDiamondReportEvents({');
            expect(source).toContain('if (diamondGame) {');
            expect(source).toContain('} else {');
            expect(source).toContain('collection(db, `teams/${teamId}/games/${gameId}/events`)');
        }
        expect(gameSource.match(/teams\/\$\{teamId\}\/games\/\$\{gameId\}\/events/g)).toHaveLength(1);
        expect(playerSource.match(/teams\/\$\{teamId\}\/games\/\$\{gameId\}\/events/g)).toHaveLength(1);
        expect(playerSource).toContain('sourcePlayIds: diamondGame ? [...statData.sourcePlayIds] : null');
        expect(helperSource).toMatch(/await invoke\(["']getPublicDiamondGame["']/);
        expect(helperSource).toMatch(/await invoke\(["']listDiamondEvents["']/);
        expect(helperSource).not.toContain('collection(db');
        expect(helperSource).not.toContain('/events`');
    });

    it('keeps Diamond reports read only and never ranks unavailable values as zero', () => {
        const gameSource = readRootFile('game.html');
        const playerSource = readRootFile('player.html');
        const teamSource = readRootFile('team.html');

        expect(gameSource).toContain('const diamondGame = isDiamondV2Game(game);');
        expect(gameSource).toContain('if (diamondGame) {');
        expect(gameSource).toContain('canEditStats = false;');
        expect(gameSource).toContain('getActivationPinnedDiamondStatCatalog({');
        expect(gameSource).toContain('resolveDiamondPublicTeamStatDocument');
        expect(gameSource).toContain("statVisibility === 'manager-internal'");
        expect(gameSource).toContain('if (canEditStats && !diamondGame)');
        expect(gameSource).toContain('loadCompleteDiamondManagerStats');
        expect(playerSource).toContain('resolveDiamondStatConfigsForGames({');
        expect(playerSource).toContain('prepareDiamondStatDocumentForSeason(data, allowedStatIds');
        expect(playerSource).toContain('loadCompleteDiamondManagerStats');
        expect(playerSource).toContain('completeStatsByPlayerId');
        expect(teamSource).toContain('Object.prototype.hasOwnProperty.call(stats, definition.id)');
        expect(teamSource).toContain('Missing or partially captured stats are not treated as zero.');
        expect(teamSource).toContain('aggregateCoverageAwareTeamStats');
        expect(teamSource).toContain('loadCompleteDiamondManagerStats');
        expect(teamSource).toContain("recordType: 'season_team'");
    });

    it('requires activation-matched configs, retries bounded failures, and exposes an accessible retry action', () => {
        const gameSource = readRootFile('game.html');
        const playerSource = readRootFile('player.html');
        const teamSource = readRootFile('team.html');

        for (const source of [gameSource, playerSource, teamSource]) {
            expect(source).toContain('resolveDiamondStatConfigsForGames({');
            expect(source).toContain('allplays/diamond-stat-config-unavailable');
            expect(source).toContain('Diamond statistic definitions could not be verified.');
            expect(source).toContain('aria-label="Retry loading Diamond statistic definitions"');
            expect(source).toContain('min-h-11');
            expect(source).toContain('window.location.reload()');
            expect(source).not.toContain('getPublicDiamondStatCatalog(');
            expect(source).not.toContain('getManagerDiamondStatCatalog(');
        }
        expect(gameSource).toContain('const configAttempts = diamondGame ? 2 : 1;');
        for (const source of [playerSource, teamSource]) {
            expect(source).toContain('loadRawDiamondStatConfigs(teamId)');
            expect(source).toContain('snapshot?.metadata?.fromCache === true');
        }
        expect(teamSource).toContain('if (configLoadError) throw configLoadError;');
        expect(teamSource).toContain('configLoadError = null;');
    });

    it('keeps season aggregation per-game pinned across mixed configs', () => {
        const playerSource = readRootFile('player.html');
        const teamSource = readRootFile('team.html');

        for (const source of [playerSource, teamSource]) {
            expect(source).toContain('hasMixedActivationPinnedDiamondStatIds({');
            expect(source).toContain('clearFamilyCoverage: statVisibility === \'public\' && hasMixedDiamondPlayerVisibility');
        }
        expect(playerSource).toContain('aggregateStatIds: aggregateDiamondStatIds');
        expect(teamSource).toContain('aggregateStatIds: aggregatePlayerStatIds');
        expect(teamSource).toContain('allowedStatIds: perGameTeamDefinitions.map(({ id }) => id)');
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
            expect(source).toContain("from './js/diamond-stat-export.js?v=7'");
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

    it('keeps validated projected-only team players in stats without exposing profile routes or raw ids', () => {
        const teamSource = readRootFile('team.html');

        expect(teamSource).toContain('const reportPlayers = buildDiamondReportPlayers({');
        expect(teamSource).toContain('documentGroups: diamondGames.map(({ game, publicDocuments }) => ({');
        expect(teamSource).toContain('rosterPlayers: players');
        expect(teamSource).toContain('players: eligiblePlayers');
        expect(teamSource).toContain('player.canOpenProfile ? player.id : undefined');
        expect(teamSource).toContain('entry.canOpenProfile');
        expect(teamSource).toContain('resolveDiamondManagerStatDocuments({');
        expect(teamSource).toContain('entry.documents = entry.publicDocuments;');
    });

    it('links classic leaderboard entries while explicit projected-only entries stay plain', () => {
        const render = loadConfiguredLeaderboardPlayerRenderer();
        const classic = render({
            rank: 1,
            playerId: 'classic-player',
            playerName: 'Classic Player',
            playerNumber: '9',
            formattedValue: '3'
        }, 'team-1');
        const projectedOnly = render({
            rank: 1,
            playerId: 'manual:private-id',
            playerName: 'Recorded Guest',
            playerNumber: '7',
            formattedValue: '4',
            canOpenProfile: false
        }, 'team-1');

        expect(classic).toContain('<a href="player.html#teamId=team-1&playerId=classic-player"');
        expect(projectedOnly).toContain('<div class="flex items-center justify-between');
        expect(projectedOnly).not.toContain('<a href=');
        expect(projectedOnly).not.toContain('manual:private-id');
    });
});
