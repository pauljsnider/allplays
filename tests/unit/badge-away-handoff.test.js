import { getTeamScorePair, calculateSeasonRecord } from '../../js/season-record.js';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { restoreBadgeScoreboard } from '../../js/live-tracker-resume.js';
import { buildFinishCompletionPlan } from '../../js/live-tracker-finish.js';
import { createOverlayState, applyOverlayGame } from '../../js/live-game-overlay-model.js';

const tracker = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../../js/live-game.js', import.meta.url), 'utf8');

// Execute the production boundary functions without booting Firebase or the page.
function extract(source, name, nextName) {
    return source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${nextName}(`));
}

describe.each([true, false])('badge handoff with isHome=%s', isHome => {
    it('keeps managed-team points together through resume, live sync, events, and completion', async () => {
        const game = { isHome, homeScore: isHome ? 7 : 3, awayScore: isHome ? 3 : 7 };
        const state = { home: 0, away: 0, history: [], period: 'Q1', clock: 0 };
        restoreBadgeScoreboard(state, game, [{ source: 'badge-score-controller', createdAt: 2000 }], null);
        expect(state).toMatchObject({ home: 7, away: 3, scoreLogIsComplete: false });
        state.home += 2; // addStat attributes a managed player's basket to state.home.
        const expected = { homeScore: isHome ? 9 : 3, awayScore: isHome ? 3 : 9 };
        const event = new Function('state', 'currentGame', 'currentUser', `${extract(tracker, 'baseLiveEvent', 'lineupSnapshot')}; return baseLiveEvent({type:'stat'});`)(state, game, null);
        expect(event).toMatchObject(expected);
        const updateGame = vi.fn().mockResolvedValue(undefined);
        let pending;
        new Function('state', 'currentGame', 'liveState', 'currentTeamId', 'currentGameId', 'updateGame', 'setTimeout', `${extract(tracker, 'scheduleScoreSync', 'scheduleLiveHasData')}; scheduleScoreSync();`)(state, game, { isLive: true }, 'team', 'game', updateGame, fn => { pending = fn; return 1; });
        await pending();
        expect(updateGame).toHaveBeenCalledWith('team', 'game', { ...expected, scoreOrientation: 'venue' });
        const finish = buildFinishCompletionPlan({ isHome, requestedHome: state.home, requestedAway: state.away, liveHome: state.home, liveAway: state.away, scoreLogIsComplete: state.scoreLogIsComplete });
        expect(finish.gameUpdate).toMatchObject(expected);
        expect(finish.finalHome).toBe(9);
        expect(calculateSeasonRecord([{ ...game, ...finish.gameUpdate }])).toEqual({ wins: 1, losses: 0, ties: 0 });
    });
    it('pairs venue scores with the correct names and photos in viewer and overlay', () => {
        const team = { name: 'Tigers', photoUrl: 'tigers.png' };
        const game = { isHome, opponent: 'Bears', opponentTeamPhoto: 'bears.png', homeScore: 3, awayScore: 7 };
        const element = () => ({ textContent: '', classList: { add() {}, remove() {} } });
        const els = { homeTeamName: element(), awayTeamName: element(), homeTeamPhoto: element(), awayTeamPhoto: element() };
        new Function('state', 'els', 'resolveOpponentDisplayName', 'updateShareButton', 'getTeamScorePair', `${extract(viewer, 'renderGameInfo', 'renderScoreboard')}; renderGameInfo();`)({team, game}, els, g => g.opponent, () => {}, getTeamScorePair);
        expect(els.homeTeamName.textContent).toBe(isHome ? 'Tigers' : 'Bears');
        expect(els.awayTeamPhoto.src).toBe(isHome ? 'bears.png' : 'tigers.png');
        const overlay = createOverlayState({ team, game });
        expect(overlay.homeName).toBe(isHome ? 'Tigers' : 'Bears');
        expect(overlay.awayName).toBe(isHome ? 'Bears' : 'Tigers');
        applyOverlayGame(overlay, { opponent: 'Wolves' });
        expect(overlay[isHome ? 'awayName' : 'homeName']).toBe('Wolves');
        expect(overlay[isHome ? 'homeName' : 'awayName']).toBe('Tigers');
    });
});

it('preserves historical away-game totals on a fresh tracker before normalizing the next write', () => {
    const game = { isHome: false, liveHasData: true, homeScore: 7, awayScore: 3 };
    const block = tracker.slice(tracker.indexOf('    const scorePair = getTeamScorePair(game);'), tracker.indexOf('    state.starters = [];', tracker.indexOf('    const scorePair = getTeamScorePair(game);')));
    const state = {};
    new Function('state', 'game', 'getTeamScorePair', block)(state, game, getTeamScorePair);
    expect(state).toEqual({ home: 7, away: 3 });
    const plan = buildFinishCompletionPlan({ isHome: false, requestedHome: state.home, requestedAway: state.away });
    expect(plan.gameUpdate).toMatchObject({ homeScore: 3, awayScore: 7, scoreOrientation: 'venue' });
    expect(getTeamScorePair({ ...game, ...plan.gameUpdate })).toEqual({ teamScore: 7, opponentScore: 3 });
});

it('keeps shared mirrors in their existing managed-team score order', () => {
    const game = { isHome: false, sharedScheduleSourceTeamId: 'source', homeScore: 7, awayScore: 3 };
    const plan = buildFinishCompletionPlan({ isHome: false, isSharedMirror: true, requestedHome: 7, requestedAway: 3 });
    expect(plan.gameUpdate).toMatchObject({ homeScore: 7, awayScore: 3, scoreOrientation: 'team-opponent' });
    expect(calculateSeasonRecord([{ ...game, ...plan.gameUpdate }])).toEqual({ wins: 1, losses: 0, ties: 0 });
});
