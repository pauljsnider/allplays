import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    buildGameReportShareUrl,
    buildGameWatchShareUrl
} from '../../js/game-share-links.js';

describe('game share links', () => {
    it('builds branded live, replay, and report links with encoded identifiers', () => {
        expect(buildGameWatchShareUrl({ teamId: 'team one', gameId: 'game/two' }))
            .toBe('https://share.allplays.ai/watch?teamId=team+one&gameId=game%2Ftwo');
        expect(buildGameWatchShareUrl({ teamId: 'team-1', gameId: 'game-1', replay: true }))
            .toBe('https://share.allplays.ai/watch?teamId=team-1&gameId=game-1&replay=true');
        expect(buildGameReportShareUrl({ teamId: 'team-1', gameId: 'game-1' }))
            .toBe('https://share.allplays.ai/report?teamId=team-1&gameId=game-1');
    });

    it('only includes a complete bounded highlight range', () => {
        expect(buildGameWatchShareUrl({
            teamId: 'team-1',
            gameId: 'game-1',
            clipStartMs: 1200.9,
            clipEndMs: 5600.8
        })).toBe('https://share.allplays.ai/watch?teamId=team-1&gameId=game-1&replay=true&clipStart=1200&clipEnd=5600');

        expect(buildGameWatchShareUrl({
            teamId: 'team-1',
            gameId: 'game-1',
            clipStartMs: 5600,
            clipEndMs: 1200
        })).toBe('https://share.allplays.ai/watch?teamId=team-1&gameId=game-1');

        expect(buildGameWatchShareUrl({
            teamId: 'team-1',
            gameId: 'game-1',
            clipEndMs: 5600
        })).toBe('https://share.allplays.ai/watch?teamId=team-1&gameId=game-1');
    });

    it('rejects missing game identifiers', () => {
        expect(() => buildGameReportShareUrl({ teamId: '', gameId: 'game-1' })).toThrow('teamId is required.');
        expect(() => buildGameWatchShareUrl({ teamId: 'team-1', gameId: '' })).toThrow('gameId is required.');
    });

    it('routes every legacy game share action through the branded builders', () => {
        const repoFile = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
        const reportPage = repoFile('game.html');
        const teamPage = repoFile('team.html');
        const liveGame = repoFile('js/live-game.js');

        expect(reportPage).toContain('const url = buildGameReportShareUrl({ teamId, gameId });');
        expect(teamPage).toContain('? buildGameReportShareUrl({ teamId: currentTeamId, gameId })');
        expect(teamPage).toContain(': buildGameWatchShareUrl({ teamId: currentTeamId, gameId });');
        expect(liveGame).toContain('? buildGameReportShareUrl({ teamId: state.teamId, gameId: state.gameId })');
        expect(liveGame).toContain(': buildGameWatchShareUrl({ teamId: state.teamId, gameId: state.gameId });');
        expect(reportPage).not.toContain('`${window.location.origin}/game.html#teamId=${teamId}&gameId=${gameId}`');
        expect(teamPage).not.toContain('`${window.location.origin}/game.html#teamId=${currentTeamId}&gameId=${gameId}`');
        expect(liveGame).not.toContain('`${window.location.origin}/live-game.html?teamId=${state.teamId}&gameId=${state.gameId}`');
    });
});
