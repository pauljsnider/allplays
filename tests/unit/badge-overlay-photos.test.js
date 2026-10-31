import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createOverlayState, applyOverlayGame } from '../../js/live-game-overlay-model.js';
it('renders the correct logo alongside each venue-oriented name and score', () => {
    const state = createOverlayState({ team: { name: 'Tigers', photoUrl: 'tigers.png' }, game: { isHome: false, scoreOrientation: 'venue', opponent: 'Bears', opponentTeamPhoto: 'bears.png', homeScore: 3, awayScore: 9 } });
    const source = readFileSync(new URL('../../js/live-game-overlay.js', import.meta.url), 'utf8');
    const render = source.slice(source.indexOf('function renderScoreboard()'), source.indexOf('function renderEventCard('));
    const elements = Object.fromEntries(['homeName', 'awayName', 'homeTeamPhoto', 'awayTeamPhoto', 'homeScore', 'awayScore', 'period', 'gameClock', 'viewerCount'].map(key => [key, {}]));
    const photo = vi.fn();
    new Function('uiState', 'elements', 'renderTeamPhoto', 'getDisplayedLiveClockMs', 'formatOverlayClock', 'setStatus', 'isCompletedGame', 'flashScore', `${render}; renderScoreboard();`)({game: state, previousHomeScore: null, previousAwayScore: null}, elements, photo, () => 0, () => '0:00', () => {}, () => false, () => {});
    expect(photo).toHaveBeenCalledWith(elements.homeTeamPhoto, 'bears.png', 'Bears team photo');
    expect(photo).toHaveBeenCalledWith(elements.awayTeamPhoto, 'tigers.png', 'Tigers team photo');
    expect(elements.awayScore.textContent).toBe('9');
    applyOverlayGame(state, { ...state.game, scoreOrientation: 'team-opponent' });
    expect(state.homePhoto).toBe('tigers.png');
});
