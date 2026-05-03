import { describe, expect, it } from 'vitest';

import {
    buildTrackStatsheetApplyPlan,
    getTrackStatsheetPointsKey,
    validateTrackStatsheetApplyRows
} from '../../js/track-statsheet-apply.js';

describe('track statsheet apply helpers', () => {
    it('blocks apply when included home rows are still unmatched', () => {
        expect(validateTrackStatsheetApplyRows([
            { include: true, mappedPlayerId: 'p1' },
            { include: true, mappedPlayerId: '' }
        ])).toEqual({
            ok: false,
            alertMessage: 'Please map every included home row to a roster player or uncheck it.'
        });
    });

    it('blocks apply when the same roster player is selected twice', () => {
        expect(validateTrackStatsheetApplyRows([
            { include: true, mappedPlayerId: 'p1' },
            { include: true, mappedPlayerId: 'p1' }
        ])).toEqual({
            ok: false,
            alertMessage: 'A roster player is selected more than once. Please fix duplicates.'
        });
    });

    it('builds aggregated stat writes and game payloads that game.html can consume', () => {
        expect(getTrackStatsheetPointsKey(['GOALS', 'SHOTS'])).toBe('goals');

        expect(buildTrackStatsheetApplyPlan({
            includedHome: [
                { mappedPlayerId: 'p1', totalPoints: 4, fouls: 2 }
            ],
            includedVisitor: [
                { name: 'Opp One', number: '10', totalPoints: 3, fouls: 1 }
            ],
            roster: [
                { id: 'p1', name: 'Ava Cole', number: '3' }
            ],
            columns: ['GOALS', 'SHOTS'],
            homeScore: 4,
            awayScore: 3,
            statSheetPhotoUrl: 'https://img.test/statsheet.png'
        })).toEqual({
            aggregatedStatsWrites: [
                {
                    playerId: 'p1',
                    data: {
                        playerName: 'Ava Cole',
                        playerNumber: '3',
                        participated: true,
                        participationStatus: 'appeared',
                        participationSource: 'statsheet-import',
                        stats: {
                            goals: 4,
                            shots: 0,
                            fouls: 2
                        }
                    }
                }
            ],
            gameUpdate: {
                homeScore: 4,
                awayScore: 3,
                opponentStats: {
                    statsheet_1: {
                        name: 'Opp One',
                        number: '10',
                        goals: 3,
                        shots: 0,
                        fouls: 1
                    }
                },
                status: 'completed',
                statSheetPhotoUrl: 'https://img.test/statsheet.png'
            }
        });
    });

    it('marks included zero-stat home rows as player profile appearances', () => {
        expect(buildTrackStatsheetApplyPlan({
            includedHome: [
                { mappedPlayerId: 'p1', totalPoints: 0, fouls: 0 }
            ],
            roster: [
                { id: 'p1', name: 'Ava Cole', number: '3' }
            ],
            columns: ['PTS'],
            homeScore: 0,
            awayScore: 0
        }).aggregatedStatsWrites).toEqual([
            {
                playerId: 'p1',
                data: {
                    playerName: 'Ava Cole',
                    playerNumber: '3',
                    participated: true,
                    participationStatus: 'appeared',
                    participationSource: 'statsheet-import',
                    stats: {
                        pts: 0,
                        fouls: 0
                    }
                }
            }
        ]);
    });
});
