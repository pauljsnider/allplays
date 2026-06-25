import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readGameHtml() {
    return readFileSync(new URL('../../game.html', import.meta.url), 'utf8');
}

describe('game auth reload', () => {
    it('forces one authenticated reload after the public auth timeout fallback loads the report', () => {
        const source = readGameHtml();

        expect(source).toContain('let gameLoadedForAuthenticatedUser = false;');
        expect(source).toContain('const shouldRefreshPermissions = gameLoaded && !gameLoadedForAuthenticatedUser && !!user;');
        expect(source).toContain('loadGame({ forceAuthenticatedReload: shouldRefreshPermissions });');
    });

    it('keeps the normal single-load guard after authenticated state has rendered', () => {
        const source = readGameHtml();

        expect(source).toContain('async function loadGame({ forceAuthenticatedReload = false } = {})');
        expect(source).toContain('let gameLoadPromise = null;');
        expect(source).toContain('if (gameLoadPromise) {');
        expect(source).toContain('await gameLoadPromise;');
        expect(source).toContain('if (gameLoaded && (!forceAuthenticatedReload || gameLoadedForAuthenticatedUser)) return;');
        expect(source).toContain('gameLoadedForAuthenticatedUser = !!currentUser;');
        expect(source).toContain('gameLoadPromise = null;');
    });

    it('resets opponent stat headers before an authenticated reload re-renders the report', () => {
        const source = readGameHtml();
        const opponentStatsStart = source.indexOf('if (game.opponentStats && Object.keys(game.opponentStats).length > 0)');
        const opponentHeaderReset = source.indexOf('opponentHeaderRow.innerHTML = `', opponentStatsStart);
        const opponentHeaderAppend = source.indexOf('oppKeys.forEach(key => {', opponentStatsStart);

        expect(opponentStatsStart).toBeGreaterThan(-1);
        expect(opponentHeaderReset).toBeGreaterThan(opponentStatsStart);
        expect(opponentHeaderReset).toBeLessThan(opponentHeaderAppend);
    });

    it('keeps public game reports loading when legacy player docs are denied', () => {
        const source = readGameHtml();

        expect(source).toContain("const playersPromise = getPlayers(teamId, { includeInactive: true }).catch((error) => {");
        expect(source).toContain("if (error?.code === 'permission-denied') {");
        expect(source).toContain("console.warn('Failed to load public roster for game report viewer:', error);");
        expect(source).toContain('return [];');
        expect(source).toContain('playersPromise');
    });

    it('keeps shareable game reports rendering when the parent team doc is private', () => {
        const source = readGameHtml();

        expect(source).toContain("const teamPromise = getTeam(teamId, { includeInactive: true }).catch((error) => {");
        expect(source).toContain("console.warn('Failed to load team document for public game report viewer:', error);");
        expect(source).toContain('return null;');
        expect(source).toContain('const resolvedTeam = team || {');
        expect(source).toContain("name: game.teamName || game.homeTeamName || 'Team'");
        expect(source).toContain("photoUrl: game.teamPhotoUrl || game.homeTeamPhoto || ''");
        expect(source).toContain("sport: game.sport || 'Basketball'");
        expect(source).toContain('if (currentUser && team) {');
        expect(source).toContain('setupSummaryControls(teamId, gameId, game, resolvedTeam, players, statsMap, statKeys, statLabels);');
    });
});
