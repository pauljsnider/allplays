import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gameSource = readFileSync(new URL('../../game.html', import.meta.url), 'utf8');

describe('legacy game report identity and auth-change contracts', () => {
    it('uses validated projection identities across every Diamond player report consumer', () => {
        expect(gameSource).toContain("import { buildDiamondReportPlayers, loadCompleteDiamondManagerStats } from './js/diamond-manager-stats.js?v=5';");
        expect(gameSource).toContain('buildDiamondReportPlayers({ rosterPlayers: players, documents: publicStatDocuments })');
        expect(gameSource).toContain('setupSummaryControls(teamId, gameId, game, resolvedTeam, reportPlayers');
        expect(gameSource).toContain('players: reportPlayers');
        expect(gameSource).toContain('const roster = reportPlayers.map');
        expect(gameSource).toContain('player.canOpenProfile === false ? {} : { playerId: player.id }');
        expect(gameSource).toContain("player.name || 'Recorded player'");
    });

    it('removes all authorization-dependent report state synchronously before reloading', () => {
        const clearStart = gameSource.indexOf('function clearManagerGameReportOnAuthChange()');
        const clearEnd = gameSource.indexOf('const authTimeout', clearStart);
        const clearSource = gameSource.slice(clearStart, clearEnd);

        expect(clearStart).toBeGreaterThan(-1);
        expect(clearSource).toContain('canEditSummary = false;');
        expect(clearSource).toContain('canViewDiamondPrivateStats = false;');
        expect(clearSource).toContain('exportButton.onclick = null;');
        for (const id of [
            'team-nav-banner',
            'stats-header-row',
            'stats-body',
            'team-stats-body',
            'team-insights-body',
            'player-insights-body',
            'published-diamond-ai-recap',
            'game-log',
            'playing-time-meta',
            'playing-time-body',
            'insights-section',
            'playing-time-insights',
            'team-stats-section',
            'diamond-report-status',
            'summary-admin',
            'summary-editor',
            'summary-edit-status',
            'summary-textarea',
            'stats-editor-status',
            'stats-editor-player-name',
            'stats-editor-player-meta'
        ]) {
            expect(clearSource).toContain(id);
        }
        expect(clearSource).toContain("'summary-edit-status', 'summary-textarea', 'summary-edit-btn'");
        expect(clearSource).toContain('control.replaceWith(control.cloneNode(true))');
        expect(gameSource.indexOf('clearManagerGameReportOnAuthChange();')).toBeLessThan(
            gameSource.indexOf('currentUser = user;')
        );
    });

    it('aborts every persistent manager listener group and guards in-flight continuations by UID and generation', () => {
        expect(gameSource).toContain('let authBoundActionController = new AbortController();');
        expect(gameSource).toContain('authBoundActionController.abort();');
        expect(gameSource).toContain('authBoundActionController = new AbortController();');
        expect(gameSource).toContain('function captureAuthBoundActionContext()');
        expect(gameSource).toContain('function isAuthBoundActionCurrent(context)');
        expect(gameSource).toContain("target.addEventListener(type, listener, { signal: context.signal });");

        const authChangeStart = gameSource.indexOf('if (identityChanged) {');
        const userSwap = gameSource.indexOf('currentUser = user;', authChangeStart);
        expect(gameSource.indexOf('renewAuthBoundActionLifecycle();', authChangeStart)).toBeLessThan(userSwap);

        const setupNames = [
            'setupReplayVideoControls',
            'setupStatSheetControls',
            'setupSummaryControls',
            'setupPostGameTeamStatEditor',
            'setupPostGameStatEditor'
        ];
        for (const [index, setupName] of setupNames.entries()) {
            const start = gameSource.indexOf(`function ${setupName}`);
            const nextStart = index + 1 < setupNames.length
                ? gameSource.indexOf(`function ${setupNames[index + 1]}`, start)
                : gameSource.indexOf('async function loadGame', start);
            const source = gameSource.slice(start, nextStart);
            expect(start).toBeGreaterThan(-1);
            expect(source).toContain('captureAuthBoundActionContext()');
            expect(source).toContain('addAuthBoundEventListener(');
            expect(source).toContain('isAuthBoundActionCurrent(actionContext)');
        }
    });

    it('checks the active UID and generation immediately after the legacy private stat read', () => {
        const readStart = gameSource.indexOf('const privateStatsSnapshot = await getDocs(');
        const processingStart = gameSource.indexOf('privateStatsSnapshot.forEach', readStart);
        const guardStart = gameSource.indexOf('if (!isCurrentGameLoad(generation, expectedUid)) return;', readStart);

        expect(readStart).toBeGreaterThan(-1);
        expect(processingStart).toBeGreaterThan(readStart);
        expect(guardStart).toBeGreaterThan(readStart);
        expect(guardStart).toBeLessThan(processingStart);
    });

    it('reconciles ambiguous stat-sheet writes before deleting the exact uploaded object', () => {
        const setupStart = gameSource.indexOf('function setupStatSheetControls');
        const setupEnd = gameSource.indexOf('async function setupSummaryControls', setupStart);
        const source = gameSource.slice(setupStart, setupEnd);

        expect(setupStart).toBeGreaterThan(-1);
        expect(source).toContain('async function readAuthoritativeStatSheetPhotoState');
        expect(source).toContain("state: 'committed'");
        expect(source).toContain("state: 'not-committed'");
        expect(source).toContain("state: 'unknown'");
        expect(source).toContain('await getGame(teamId, gameId)');
        expect(source).toContain("persistenceState === 'not-committed'");
        expect(source).toContain("persistenceState === 'unknown'");
    });
});
