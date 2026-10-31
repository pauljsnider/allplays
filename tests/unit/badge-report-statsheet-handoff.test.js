import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getTeamScorePair } from '../../js/season-record.js';
import { buildFinishCompletionPlan } from '../../js/live-tracker-finish.js';
import { buildTrackStatsheetApplyPlan } from '../../js/track-statsheet-apply.js';
import { buildFinishGamePayload } from '../../js/game-day-wrapup.js';

const report = readFileSync(new URL('../../game.html', import.meta.url), 'utf8');
const body = report.match(/function resolveGameReportScoreView\(game = \{\}\) \{([\s\S]*?)\n        \}/)[1];
const view = game => new Function('game', 'getTeamScorePair', body)(game, getTeamScorePair);

describe('badge score orientation at report and replacement boundaries', () => {
    it('reports an away win after live tracker completion', () => {
        const plan = buildFinishCompletionPlan({ isHome: false, requestedHome: 9, requestedAway: 3 });
        expect(view({ isHome: false, ...plan.gameUpdate })).toMatchObject({ teamScore: 9, opponentScore: 3, isWin: true });
    });
    it('overwrites venue orientation when replacing with a statsheet or wrapup', () => {
        const prior = { isHome: false, homeScore: 3, awayScore: 9, scoreOrientation: 'venue' };
        const sheet = buildTrackStatsheetApplyPlan({ homeScore: 11, awayScore: 4 });
        const wrapup = buildFinishGamePayload({ homeScoreValue: '11', awayScoreValue: '4' });
        for (const update of [sheet.gameUpdate, wrapup]) {
            expect(getTeamScorePair({ ...prior, ...update })).toEqual({ teamScore: 11, opponentScore: 4 });
            expect(view({ ...prior, ...update }).isWin).toBe(true);
        }
    });
    it.each(['track.html', 'track-live.html'])('normalizes managed-team scores on %s resume', file => {
        const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
        const block = source.match(/const scores = getTeamScorePair\(game\);\s*homeScore = scores.teamScore \|\| 0;\s*awayScore = scores.opponentScore \|\| 0;/)?.[0];
        expect(block).toBeTruthy();
        const result = new Function('game', 'getTeamScorePair', `let homeScore, awayScore; ${block}; return [homeScore, awayScore];`)({ isHome: false, homeScore: 3, awayScore: 9, scoreOrientation: 'venue' }, getTeamScorePair);
        expect(result).toEqual([9, 3]);
    });
});
