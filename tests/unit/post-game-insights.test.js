import { describe, expect, it } from 'vitest';

import { generateGameInsights, generatePlayerGameInsights } from '../../js/post-game-insights.js';

const players = [
    { id: 'p1', name: 'Ava Cole', number: '3' },
    { id: 'p2', name: 'Mia Brooks', number: '12' },
    { id: 'p3', name: 'Zoe Lane', number: '21' }
];

describe('generateGameInsights', () => {
    it('builds team and player insights from stats, playing time, and play-by-play', () => {
        const result = generateGameInsights({
            team: { name: 'All Plays' },
            game: { opponent: 'Falcons', homeScore: 42, awayScore: 35, status: 'completed' },
            players,
            statsMap: {
                p1: { pts: 18, ast: 4, reb: 5, fouls: 1, to: 1 },
                p2: { pts: 12, reb: 6, fouls: 4, to: 3 },
                p3: { pts: 8, ast: 3, fouls: 0, to: 0 }
            },
            timeMap: {
                p1: 1800000,
                p2: 1500000,
                p3: 600000
            },
            events: [
                { playerId: 'p1', text: 'Ava Cole hits a 3-pointer', period: 'Q4', clock: '02:10', statKey: 'pts', value: 3, isOpponent: false },
                { playerId: 'p2', text: 'Mia Brooks turnover', period: 'Q4', clock: '01:42', undoData: { statKey: 'to', value: 1, isOpponent: false } },
                { text: 'Falcons make layup', period: 'Q4', clock: '01:15', statKey: 'pts', value: 2, isOpponent: true },
                { playerId: 'p1', text: 'Ava Cole makes layup', period: 'Q4', clock: '00:48', statKey: 'pts', value: 2, isOpponent: false },
                { playerId: 'p2', text: 'Mia Brooks foul', period: 'Q3', clock: '05:10', undoData: { statKey: 'fouls', value: 1, isOpponent: false } }
            ]
        });

        expect(result.teamInsights.length).toBeGreaterThanOrEqual(4);
        expect(result.teamInsights.map((item) => item.title)).toEqual(expect.arrayContaining([
            'Offensive catalyst',
            'Rotation pattern',
            'Late-game swing',
            'Discipline watch'
        ]));
        expect(result.teamInsights.find((item) => item.title === 'Offensive catalyst')?.body).toContain('Ava Cole');
        expect(result.teamInsights.find((item) => item.title === 'Late-game swing')?.body).toContain('Q4');

        expect(result.playerInsightsById.p1.map((item) => item.title)).toContain('Scoring load');
        expect(result.playerInsightsById.p2.map((item) => item.title)).toContain('Foul pressure');
    });

    it('returns empty-state metadata when finalized games have no usable activity', () => {
        const result = generateGameInsights({
            team: { name: 'All Plays' },
            game: { opponent: 'Falcons', homeScore: 0, awayScore: 0, status: 'completed' },
            players,
            statsMap: {},
            timeMap: {},
            events: []
        });

        expect(result.teamInsights).toEqual([]);
        expect(result.playerInsightsById).toEqual({});
        expect(result.emptyMessage).toContain('No post-game insights');
    });

    it('supports non-basketball scoring stats such as goals and generic support actions', () => {
        const result = generateGameInsights({
            team: { name: 'Dogs', sport: 'Soccer' },
            game: { opponent: 'Todo', homeScore: 2, awayScore: 3, status: 'completed', liveStatus: 'completed' },
            players: [
                { id: 'p1', name: 'paul', number: '1' },
                { id: 'p2', name: 'jack', number: '2' }
            ],
            statsMap: {
                p1: { goals: 1, shots: 1, blocks: 1 },
                p2: { goals: 1, passes: 1, hustle: 1 }
            },
            timeMap: {},
            events: [
                { playerId: 'p1', text: '#1 paul +1 GOALS', period: 'H1', clock: '4:53', statKey: 'GOALS', value: 1, isOpponent: false },
                { playerId: 'p2', text: '#2 jack +1 GOALS', period: 'H1', clock: '4:54', statKey: 'GOALS', value: 1, isOpponent: false }
            ]
        });

        expect(result.teamInsights.map((item) => item.title)).toContain('Offensive catalyst');
        expect(result.teamInsights.find((item) => item.title === 'Offensive catalyst')?.body).toContain('goal');
        expect(result.playerInsightsById.p1.map((item) => item.title)).toEqual(expect.arrayContaining([
            'Scoring load',
            'All-around impact'
        ]));
        expect(result.playerInsightsById.p2.map((item) => item.title)).toEqual(expect.arrayContaining([
            'Scoring load',
            'All-around impact'
        ]));
    });

    it('does not treat non-scoring goal-like text as a scoring event', () => {
        const result = generateGameInsights({
            team: { name: 'Dogs', sport: 'Soccer' },
            game: { opponent: 'Todo', homeScore: 0, awayScore: 0, status: 'completed', liveStatus: 'completed' },
            players: [
                { id: 'p1', name: 'Keeper', number: '1' }
            ],
            statsMap: {
                p1: { shots: 0, passes: 1 }
            },
            timeMap: {},
            events: [
                { playerId: 'p1', text: 'Keeper +1 GOALKEEPER SAVE', period: 'H2', clock: '2:10', statKey: 'goalkeeper_saves', value: 1, isOpponent: false },
                { playerId: 'p1', text: 'Keeper +1 GOAL KICK', period: 'H2', clock: '1:40', statKey: 'goal_kicks', value: 1, isOpponent: false }
            ]
        });

        expect(result.teamInsights.map((item) => item.title)).not.toContain('Late-game swing');
        expect(result.playerInsightsById.p1?.map((item) => item.title) || []).not.toContain('Closing presence');
    });
});

describe('generatePlayerGameInsights', () => {
    it('summarizes a selected player game with personalized takeaways', () => {
        const result = generatePlayerGameInsights({
            player: players[0],
            game: { opponent: 'Falcons', status: 'completed' },
            playerStats: { pts: 18, ast: 4, reb: 5, fouls: 1, to: 1 },
            playerTimeMs: 1800000,
            gameTeamStats: {
                p1: { pts: 18, ast: 4, reb: 5, fouls: 1, to: 1 },
                p2: { pts: 12, reb: 6, fouls: 4, to: 3 },
                p3: { pts: 8, ast: 3, fouls: 0, to: 0 }
            },
            events: [
                { playerId: 'p1', text: 'Ava Cole hits a 3-pointer', period: 'Q4', clock: '02:10', statKey: 'pts', value: 3, isOpponent: false },
                { playerId: 'p1', text: 'Ava Cole makes layup', period: 'Q4', clock: '00:48', statKey: 'pts', value: 2, isOpponent: false }
            ]
        });

        expect(result.length).toBeGreaterThanOrEqual(3);
        expect(result.map((item) => item.title)).toEqual(expect.arrayContaining([
            'Scoring load',
            'All-around impact',
            'Closing presence'
        ]));
    });
});
