import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { getTeamScorePair } from '../../js/season-record.js';
import { commitStandardTrackerFinishData } from '../../js/track-finish.js';

const source = readFileSync(new URL('../../js/track-basketball.js', import.meta.url), 'utf8');
const hydration = source.slice(source.indexOf('    // Reset base state'), source.indexOf('    state.starters = [];', source.indexOf('    // Reset base state')));

describe('basketball beta tracker handoff', () => {
    it.each([
        { isHome: false, homeScore: 3, awayScore: 7, scoreOrientation: 'venue' },
        { isHome: false, homeScore: 7, awayScore: 3, liveHasData: true },
        { isHome: true, homeScore: 7, awayScore: 3, scoreOrientation: 'venue' }
    ])('preserves a managed-team lead through resume, basket and completion: %j', async (game) => {
        const state = {};
        runInNewContext(hydration, { state, game, getTeamScorePair });
        expect([state.home, state.away]).toEqual([7, 3]);
        state.home += 2;
        let saved;
        await commitStandardTrackerFinishData({
            db: {}, teamId: 'team', gameId: 'game', gameLog: [], players: [],
            playerStatsByPlayerId: {}, columns: ['PTS'], finalHome: state.home,
            finalAway: state.away, summary: '', opponentStats: {},
            doc: () => ({}), collection: () => ({}),
            writeBatch: () => ({ set() {}, delete() {}, update(_ref, value) { saved = value; }, async commit() {} })
        });
        expect(getTeamScorePair({ ...game, ...saved })).toEqual({ teamScore: 9, opponentScore: 3 });
        expect(saved.scoreOrientation).toBe('team-opponent');
    });
});
