import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readPage(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('scoreboard widget embed', () => {
    it('adds team page tools to copy an iframe embed code and link', () => {
        const source = readPage('team.html');

        expect(source).toContain('id="scoreboard-widget-tools"');
        expect(source).toContain('Scoreboard widget');
        expect(source).toContain('data-copy-scoreboard-widget="embed"');
        expect(source).toContain('data-copy-scoreboard-widget="link"');
        expect(source).toContain('function buildScoreboardWidgetEmbedCode()');
        expect(source).toContain('widget-scoreboard.html?teamId=${encodeURIComponent(currentTeamId)}');
        expect(source).toContain('<iframe src="${url}"');
    });

    it('adds a read-only public widget page backed by team games', () => {
        const source = readPage('widget-scoreboard.html');

        expect(source).toContain('ALL PLAYS live scoreboard');
        expect(source).toContain("import { getTeam, getGames } from './js/db.js?v=62';");
        expect(source).toContain('const REFRESH_MS = 60000;');
        expect(source).toContain('function selectWidgetGames(games)');
        expect(source).toContain('.filter((game) => game._date && (isLive(game) || game._date >= now || (isCompleted(game) && game._date >= recentCutoff)))');
        expect(source).not.toContain('|| !isCompleted(game) || isLive(game)');
        expect(source).toContain('function renderGame(game)');
        expect(source).toContain('const teamScore = game.isHome === false ? awayScore : homeScore;');
        expect(source).toContain('const opponentScore = game.isHome === false ? homeScore : awayScore;');
        expect(source).toContain("const scoreLabel = typeof game.isHome === 'boolean' ? 'team - opponent' : 'home - away';");
        expect(source).toContain('${teamScore} - ${opponentScore}');
        expect(source).toContain('${scoreLabel}');
        expect(source).toContain('team - opponent');
        expect(source).toContain('home - away');
        expect(source).not.toContain('tracking-wide">team - opponent</div>');
        expect(source).not.toContain('${homeScore} - ${awayScore}');
        expect(source).toContain('live-game.html?teamId=${encodeURIComponent(state.teamId)}&gameId=${encodeURIComponent(gameId)}');
        expect(source).toContain('function clearRefreshTimer()');
        expect(source).toContain("window.addEventListener('pagehide', clearRefreshTimer);");
        expect(source).toContain("window.addEventListener('beforeunload', clearRefreshTimer);");
        expect(source).toContain('Read-only public scoreboard');
    });
});
