import { describe, it, expect } from 'vitest';
import {
    createSingleEliminationBracket,
    reportBracketGameResult,
    publishBracket,
    buildPublishedBracketView
} from '../../js/bracket-management.js';

describe('bracket management helpers', () => {
    it('builds seeded single-elimination pairings with source rules', () => {
        const bracket = createSingleEliminationBracket({
            teamId: 'team-1',
            name: 'Spring Cup',
            seeds: [
                { seed: 1, teamId: 't1', teamName: 'Seed 1' },
                { seed: 2, teamId: 't2', teamName: 'Seed 2' },
                { seed: 3, teamId: 't3', teamName: 'Seed 3' },
                { seed: 4, teamId: 't4', teamName: 'Seed 4' },
                { seed: 5, teamId: 't5', teamName: 'Seed 5' },
                { seed: 6, teamId: 't6', teamName: 'Seed 6' },
                { seed: 7, teamId: 't7', teamName: 'Seed 7' },
                { seed: 8, teamId: 't8', teamName: 'Seed 8' }
            ]
        });

        expect(bracket.format).toBe('single_elimination');
        expect(bracket.status).toBe('draft');
        expect(bracket.games).toHaveLength(7);

        const roundOneGames = bracket.games.filter((game) => game.roundIndex === 0);
        expect(roundOneGames).toHaveLength(4);
        expect(roundOneGames[0].homeSlot.sourceRef).toBe('seed:1');
        expect(roundOneGames[0].awaySlot.sourceRef).toBe('seed:8');
        expect(roundOneGames[1].homeSlot.sourceRef).toBe('seed:4');
        expect(roundOneGames[1].awaySlot.sourceRef).toBe('seed:5');

        const semifinal = bracket.games.find((game) => game.id === 'R2G1');
        expect(semifinal.homeSlot.sourceType).toBe('winner');
        expect(semifinal.homeSlot.sourceRef).toBe('R1G1');
        expect(semifinal.awaySlot.sourceRef).toBe('R1G2');
    });

    it('auto-advances winners across rounds when results are reported', () => {
        const bracket = createSingleEliminationBracket({
            teamId: 'team-1',
            name: 'Spring Cup',
            seeds: [
                { seed: 1, teamId: 't1', teamName: 'Seed 1' },
                { seed: 2, teamId: 't2', teamName: 'Seed 2' },
                { seed: 3, teamId: 't3', teamName: 'Seed 3' },
                { seed: 4, teamId: 't4', teamName: 'Seed 4' }
            ]
        });

        const afterGameOne = reportBracketGameResult(bracket, {
            gameId: 'R1G1',
            winnerSlot: 'home',
            scores: { home: 2, away: 0 }
        });

        const semifinal = afterGameOne.games.find((game) => game.id === 'R2G1');
        expect(semifinal.homeSlot.teamId).toBe('t1');

        const afterGameTwo = reportBracketGameResult(afterGameOne, {
            gameId: 'R1G2',
            winnerSlot: 'home',
            scores: { home: 3, away: 1 }
        });

        const final = afterGameTwo.games.find((game) => game.id === 'R2G1');
        expect(final.homeSlot.teamId).toBe('t1');
        expect(final.awaySlot.teamId).toBe('t2');
    });

    it('auto-advances BYE teams during bracket creation', () => {
        const bracket = createSingleEliminationBracket({
            teamId: 'team-1',
            name: 'Three Team Cup',
            seeds: [
                { seed: 1, teamId: 't1', teamName: 'Seed 1' },
                { seed: 2, teamId: 't2', teamName: 'Seed 2' },
                { seed: 3, teamId: 't3', teamName: 'Seed 3' }
            ]
        });

        const autoResolvedQuarter = bracket.games.find((game) => game.id === 'R1G1');
        expect(autoResolvedQuarter.status).toBe('completed');
        expect(autoResolvedQuarter.winnerTeamId).toBe('t1');

        const final = bracket.games.find((game) => game.id === 'R2G1');
        expect(final.homeSlot.teamId).toBe('t1');
    });

    it('publishes brackets and exposes public-safe read model', () => {
        const bracket = createSingleEliminationBracket({
            teamId: 'team-1',
            name: 'Publish Cup',
            seeds: [
                { seed: 1, teamId: 't1', teamName: 'Seed 1' },
                { seed: 2, teamId: 't2', teamName: 'Seed 2' }
            ]
        });

        const published = publishBracket(bracket, { publishedBy: 'user-1', publishedAt: '2026-03-05T11:26:00Z' });
        expect(published.status).toBe('published');
        expect(published.publishedBy).toBe('user-1');

        const view = buildPublishedBracketView(published);
        expect(view.status).toBe('published');
        expect(view.internalNotes).toBeUndefined();
        expect(view.games).toHaveLength(1);
    });
});
