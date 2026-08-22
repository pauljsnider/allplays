import { describe, expect, it } from 'vitest';
import {
    applyOverlayEvents,
    applyOverlayGame,
    createOverlayDemoFixture,
    createOverlayState,
    formatOverlayClock,
    getOverlayEventTone,
    getOverlayLineup,
    replaceOverlayChat
} from '../../js/live-game-overlay-model.js';

describe('live game overlay model', () => {
    it('formats a bounded broadcast clock', () => {
        expect(formatOverlayClock(0)).toBe('0:00');
        expect(formatOverlayClock(65_999)).toBe('1:05');
        expect(formatOverlayClock(-5_000)).toBe('0:00');
        expect(formatOverlayClock('not-a-clock')).toBe('0:00');
    });

    it('normalizes game context and applies passive game-document updates', () => {
        const state = createOverlayState({
            team: { name: 'Vipers' },
            game: {
                opponentTeamName: 'Union KC',
                homeScore: 1,
                awayScore: 0,
                period: 'H1',
                liveClockMs: 1_200_000,
                liveStatus: 'live',
                liveLineup: { onCourt: ['p1'], bench: ['p2'] }
            },
            players: [
                { id: 'p1', name: 'Alex', number: 4 },
                { id: 'p2', name: 'Jordan', number: 7 }
            ]
        });

        applyOverlayGame(state, {
            opponent: 'Sporting Blue',
            homeScore: 2,
            awayScore: 1,
            period: 'H2',
            gameClockMs: 350_000,
            liveStatus: 'completed'
        });

        expect(state).toMatchObject({
            homeName: 'Vipers',
            awayName: 'Sporting Blue',
            homeScore: 2,
            awayScore: 1,
            period: 'H2',
            gameClockMs: 350_000,
            liveStatus: 'completed'
        });
        expect(getOverlayLineup(state, 'onCourt').map((player) => player.name)).toEqual(['Alex']);
        expect(getOverlayLineup(state, 'bench').map((player) => player.name)).toEqual(['Jordan']);
    });

    it('deduplicates event snapshots while applying absolute score and player stats', () => {
        const state = createOverlayState({
            team: { name: 'Vipers' },
            game: { opponent: 'Union KC', liveStatus: 'live' },
            players: [{ id: 'p11', name: 'Bennett Kurtz', number: '11' }]
        });
        const goal = {
            id: 'goal-1',
            type: 'goal',
            description: 'Kurtz scores',
            playerId: 'p11',
            statKey: 'goals',
            value: 1,
            homeScore: 1,
            awayScore: 0,
            period: 'H1',
            gameClockMs: 420_000,
            createdAt: 1000
        };

        applyOverlayEvents(state, [goal]);
        applyOverlayEvents(state, [goal]);

        expect(state.homeScore).toBe(1);
        expect(state.awayScore).toBe(0);
        expect(state.stats.p11.goals).toBe(1);
        expect(state.events).toHaveLength(1);
        expect(state.latestEvent).toMatchObject({ id: 'goal-1', tone: 'home-score', label: 'GOAL' });
    });

    it('keeps provider-side events distinct and resets overlay history safely', () => {
        const state = createOverlayState({ game: {}, events: [{ id: 'old', description: 'Old play', createdAt: 1 }] });
        applyOverlayEvents(state, [{ id: 'reset', type: 'reset', description: 'Game reset', createdAt: 2 }]);
        applyOverlayEvents(state, [{ id: 'away', type: 'goal', isOpponent: true, awayScore: 1, createdAt: 3 }]);

        expect(getOverlayEventTone({ type: 'clock_pause' })).toBe('system');
        expect(getOverlayEventTone({ type: 'goal', isOpponent: true })).toBe('away-score');
        expect(state.events.map((event) => event.id)).toEqual(['away', 'reset']);
        expect(state.awayScore).toBe(1);
    });

    it('sorts replacement chat and supplies a realistic local fixture', () => {
        const state = createOverlayState();
        replaceOverlayChat(state, [
            { id: 'older', senderName: 'One', text: 'Earlier', createdAt: 10 },
            { id: 'newer', senderName: 'Two', text: 'Latest', createdAt: 20 }
        ]);
        const fixture = createOverlayDemoFixture(100_000);

        expect(state.chatMessages.map((message) => message.id)).toEqual(['newer', 'older']);
        expect(fixture.game.liveStatus).toBe('live');
        expect(fixture.events.length).toBeGreaterThanOrEqual(4);
        expect(fixture.players.length).toBeGreaterThanOrEqual(6);
    });
});
