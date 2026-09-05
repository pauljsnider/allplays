import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readRepo = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('legacy tracker Diamond ownership guard', () => {
    for (const page of ['track.html', 'track-live.html']) {
        it(`${page} redirects Diamond games before any tracker initialization`, () => {
            const source = readRepo(page);
            const engineGuard = source.indexOf('if (game.trackingEngine === DIAMOND_ENGINE)');
            const assignment = source.indexOf('currentGame = game;', engineGuard);

            expect(source).toContain("from './js/diamond-scorebook-routing.js?v=1'");
            expect(engineGuard).toBeGreaterThan(-1);
            expect(source.slice(engineGuard, assignment)).toContain('window.location.replace(buildDiamondTrackerUrl(teamId, gameId))');
            expect(source.slice(engineGuard, assignment)).toContain('if (game.trackingEngine)');
            expect(assignment).toBeGreaterThan(engineGuard);
        });
    }

    it('dispatches schedule and game-day launchers through the shared scorer URL', () => {
        const schedule = readRepo('edit-schedule.html');
        const gameDay = readRepo('game-day.html');

        expect(schedule).toContain('if (game.trackingEngine === DIAMOND_ENGINE)');
        expect(schedule).toContain('window.location.href = buildDiamondTrackerUrl(currentTeamId, gameId)');
        expect(schedule).toContain('await getDiamondGameAccess(currentTeamId, gameId)');
        expect(schedule).toContain("activateDiamondGameForLegacy(currentTeamId, gameId, mode)");
        expect(schedule).toContain('The legacy tracker is still available.');
        expect(schedule).toContain('diamond-tracker-quick');
        expect(schedule).toContain('diamond-tracker-full');
        expect(gameDay).toContain('if (state.game?.trackingEngine === DIAMOND_ENGINE)');
        expect(gameDay).toContain('return buildDiamondTrackerUrl(state.teamId, state.gameId)');
        expect(gameDay).toContain('buildDiamondViewerUrl({ teamId: state.teamId, gameId: state.gameId })');
        expect(gameDay).toContain('if (game.trackingEngine === DIAMOND_ENGINE)');
        expect(gameDay).toContain('renderLimitedScorekeepingAccess(accessInfo)');
    });
});
