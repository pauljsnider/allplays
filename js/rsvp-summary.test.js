import { expect } from 'chai';
import { computeEffectiveRsvpSummary, selectLatestRsvpByPlayer } from './rsvp-summary.js';

describe('rsvp-summary', () => {
    describe('selectLatestRsvpByPlayer', () => {
        const mockRsvps = [
            { playerId: 'player1', response: 'going', respondedAt: new Date('2026-01-01T10:00:00Z'), userId: 'user1' },
            { playerId: 'player2', response: 'not_going', respondedAt: new Date('2026-01-01T11:00:00Z'), userId: 'user2' },
            { playerId: 'player1', response: 'maybe', respondedAt: new Date('2026-01-01T12:00:00Z'), userId: 'user1' }, // Later RSVP for player1
        ];

        const fallbackByUser = {};
        const normalizeResponse = (response) => response;
        const resolvePlayerIds = (rsvp) => [rsvp.playerId];

        it('should return the latest RSVP for each player', () => {
            const latestByPlayer = selectLatestRsvpByPlayer({
                rsvps: mockRsvps,
                fallbackByUser,
                normalizeResponse,
                resolvePlayerIds,
                includePlayerId: () => true,
            });

            expect(latestByPlayer.size).to.equal(2);
            expect(latestByPlayer.get('player1').responseKey).to.equal('maybe');
            expect(latestByPlayer.get('player2').responseKey).to.equal('not_going');
        });

        it('should filter by includePlayerId function', () => {
            const latestByPlayer = selectLatestRsvpByPlayer({
                rsvps: mockRsvps,
                fallbackByUser,
                normalizeResponse,
                resolvePlayerIds,
                includePlayerId: (playerId) => playerId === 'player1',
            });

            expect(latestByPlayer.size).to.equal(1);
            expect(latestByPlayer.get('player1').responseKey).to.equal('maybe');
        });
    });

    describe('computeEffectiveRsvpSummary', () => {
        const normalizeResponse = (response) => response;
        const resolvePlayerIds = (rsvp) => [rsvp.playerId];
        const fallbackByUser = {};

        it('should return an empty summary for no active roster', () => {
            const summary = computeEffectiveRsvpSummary({
                rsvps: [],
                activeRosterIds: new Set(),
                fallbackByUser,
                normalizeResponse,
                resolvePlayerIds,
            });
            expect(summary).to.deep.equal({ going: 0, maybe: 0, notGoing: 0, notResponded: 0, total: 0, notRespondedPlayerIds: [] });
        });

        it('should correctly summarize RSVPs with all players responded', () => {
            const rsvps = [
                { playerId: 'player1', response: 'going', respondedAt: new Date() },
                { playerId: 'player2', response: 'not_going', respondedAt: new Date() },
                { playerId: 'player3', response: 'maybe', respondedAt: new Date() },
            ];
            const activeRosterIds = new Set(['player1', 'player2', 'player3']);

            const summary = computeEffectiveRsvpSummary({
                rsvps,
                activeRosterIds,
                fallbackByUser,
                normalizeResponse,
                resolvePlayerIds,
            });

            expect(summary).to.deep.equal({
                going: 1,
                maybe: 1,
                notGoing: 1,
                notResponded: 0,
                total: 3,
                notRespondedPlayerIds: [],
            });
        });

        it('should correctly identify non-responded players', () => {
            const rsvps = [
                { playerId: 'player1', response: 'going', respondedAt: new Date() },
                { playerId: 'player3', response: 'maybe', respondedAt: new Date() },
            ];
            const activeRosterIds = new Set(['player1', 'player2', 'player3', 'player4']);

            const summary = computeEffectiveRsvpSummary({
                rsvps,
                activeRosterIds,
                fallbackByUser,
                normalizeResponse,
                resolvePlayerIds,
            });

            expect(summary).to.deep.equal({
                going: 1,
                maybe: 1,
                notGoing: 0,
                notResponded: 2,
                total: 4,
                notRespondedPlayerIds: ['player2', 'player4'],
            });
        });

        it('should handle no RSVPs for active roster', () => {
            const rsvps = [];
            const activeRosterIds = new Set(['player1', 'player2']);

            const summary = computeEffectiveRsvpSummary({
                rsvps,
                activeRosterIds,
                fallbackByUser,
                normalizeResponse,
                resolvePlayerIds,
            });

            expect(summary).to.deep.equal({
                going: 0,
                maybe: 0,
                notGoing: 0,
                notResponded: 2,
                total: 2,
                notRespondedPlayerIds: ['player1', 'player2'],
            });
        });
    });
});
